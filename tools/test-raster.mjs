#!/usr/bin/env node
// Checks js/raster.js against brother_ql, the reference QL driver.
//
//   python3 -m venv .bq && .bq/bin/pip install brother_ql==0.9.4 "Pillow<10"
//   node tools/test-raster.mjs .bq/bin/python
//
// For each model/label pair it renders the same random bitmap through both
// implementations and requires identical bytes.

import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildQLJob, modelById, labelById, packbits, parseStatus, matchLoaded,
} from "../js/raster.js";

const python = process.argv[2] || "python3";
const dir = mkdtempSync(path.join(tmpdir(), "raster-"));

function randomBitmap(width, height, seed) {
  let state = seed;
  const next = () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const data = new Uint8Array(width * height);
  // Text-like content: runs of ink and blank rows, so PackBits gets exercised.
  for (let y = 0; y < height; y += 1) {
    if (y % 9 > 6) continue;
    for (let x = 0; x < width; x += 1) data[y * width + x] = next() < 0.35 ? 1 : 0;
  }
  // A solid block and an asymmetric marker reveal any mirroring mistakes.
  for (let y = 0; y < Math.min(20, height); y += 1) {
    for (let x = 0; x < Math.min(60, width); x += 1) data[y * width + x] = 1;
  }
  return { width, height, data };
}

function toPbm(bitmap, file) {
  const header = `P4\n${bitmap.width} ${bitmap.height}\n`;
  const rowBytes = Math.ceil(bitmap.width / 8);
  const body = new Uint8Array(rowBytes * bitmap.height);
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      if (bitmap.data[y * bitmap.width + x]) body[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  writeFileSync(file, Buffer.concat([Buffer.from(header), Buffer.from(body)]));
}

const reference = `
import sys, logging
logging.disable(logging.CRITICAL)
from PIL import Image
from brother_ql.raster import BrotherQLRaster
from brother_ql.conversion import convert
model, label, compress, copies, image, out = sys.argv[1:7]
im = Image.open(image).convert("L")
# PBM 1 = black; PIL loads that as black (0), as brother_ql expects
qlr = BrotherQLRaster(model)
qlr.exception_on_warning = False
data = convert(qlr, [im] * int(copies), label, cut=True, compress=compress == "1", hq=True)
open(out, "wb").write(data)
`;
writeFileSync(path.join(dir, "ref.py"), reference);

const cases = [
  ["QL-800", "62", false, 1],
  ["QL-800", "52x29", false, 1],
  ["QL-800", "29", false, 1],
  ["QL-800", "62x29", false, 3],
  ["QL-800", "29x90", false, 1],
  ["QL-800", "17x54", false, 1],
  ["QL-700", "62", false, 1],
  ["QL-570", "38", false, 2],
  ["QL-820NWB", "62", true, 1],
  ["QL-820NWB", "52x29", true, 2],
  ["QL-720NW", "50", true, 1],
  ["QL-1060N", "102", true, 1],
];

let failures = 0;
for (const [modelId, labelId, compress, copies] of cases) {
  const model = modelById(modelId);
  const label = labelById(model, labelId);
  const height = label.kind === "diecut" ? label.printable[1] : 240;
  const bitmap = randomBitmap(label.printable[0], height, 7 + copies);

  const image = path.join(dir, `${modelId}-${labelId}.pbm`);
  const outFile = path.join(dir, `${modelId}-${labelId}.bin`);
  toPbm(bitmap, image);
  execFileSync(python, [path.join(dir, "ref.py"), modelId, labelId, compress ? "1" : "0",
    String(copies), image, outFile]);

  const expected = new Uint8Array(readFileSync(outFile));
  const actual = buildQLJob({ model, label, pages: Array(copies).fill(bitmap), compress });

  let at = -1;
  const length = Math.max(expected.length, actual.length);
  for (let i = 0; i < length; i += 1) if (expected[i] !== actual[i]) { at = i; break; }

  const tag = `${modelId.padEnd(10)} ${labelId.padEnd(7)} ${compress ? "packbits" : "raw     "} x${copies}`;
  if (at === -1) {
    console.log(`  ok    ${tag}  ${actual.length} bytes identical`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${tag}  first difference at byte ${at}: ` +
      `expected ${expected[at]} got ${actual[at]} (lengths ${expected.length}/${actual.length})`);
  }
}

// PackBits round-trip on edge cases.
const decode = (data) => {
  const out = [];
  for (let i = 0; i < data.length;) {
    const n = data[i++];
    if (n < 128) { out.push(...data.slice(i, i + n + 1)); i += n + 1; }
    else if (n > 128) { out.push(...Array(257 - n).fill(data[i])); i += 1; }
  }
  return Uint8Array.from(out);
};
for (const sample of [[0], [5, 5], new Array(300).fill(0), [1, 2, 3, 3, 3, 4], new Array(200).fill(0).map((_, i) => i % 3)]) {
  const input = Uint8Array.from(sample);
  const ok = decode(packbits(input)).join() === input.join();
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  packbits round-trip (${input.length} bytes)`);
}

// Status parsing: a QL-800 reporting 52x29 die-cut, idle.
const status = new Uint8Array(32);
status.set([0x80, 0x20, 0x42, 0x34, 0x38], 0);
status[10] = 52; status[11] = 0x0b; status[17] = 29;
const parsed = parseStatus(status);
const loaded = matchLoaded(modelById("QL-800"), parsed);
const statusOk = loaded?.id === "52x29" && parsed.errors.length === 0;
if (!statusOk) failures += 1;
console.log(`  ${statusOk ? "ok  " : "FAIL"}  status 52/29 die-cut -> ${loaded?.id}`);

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
