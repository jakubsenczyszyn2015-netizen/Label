// Brother raster protocol — pure functions, no DOM, so they run (and are
// tested) under Node as well as in the browser.
//
// The QL half is a faithful port of brother_ql (the open-source driver most
// QL tooling uses): same command order, same label geometry, same row
// mirroring, same PackBits. tools/test-raster.mjs checks it byte-for-byte
// against brother_ql's own output.
//
// A "bitmap" here is { width, height, data } where data is a Uint8Array of
// width*height entries, 1 = ink, 0 = paper, row-major from the top-left of
// the label as it is read.

/* ---------- Printers ---------- */

// Capabilities per model, from brother_ql's model table. bytesPerRow is the
// print head width; extraOffset shifts wide models; compression is a hard
// requirement — sending compressed rows to a model without it prints garbage.
export const QL_MODELS = {
  "QL-500":    { bytesPerRow: 90,  compression: false, cutting: false, expanded: false, modeSetting: false },
  "QL-550":    { bytesPerRow: 90,  compression: false, cutting: true,  expanded: true,  modeSetting: false },
  "QL-560":    { bytesPerRow: 90,  compression: false, cutting: true,  expanded: true,  modeSetting: false },
  "QL-570":    { bytesPerRow: 90,  compression: false, cutting: true,  expanded: true,  modeSetting: false },
  "QL-580N":   { bytesPerRow: 90,  compression: true,  cutting: true,  expanded: true,  modeSetting: true },
  "QL-650TD":  { bytesPerRow: 90,  compression: true,  cutting: true,  expanded: true,  modeSetting: true },
  "QL-700":    { bytesPerRow: 90,  compression: false, cutting: true,  expanded: true,  modeSetting: false },
  "QL-710W":   { bytesPerRow: 90,  compression: true,  cutting: true,  expanded: true,  modeSetting: true },
  "QL-720NW":  { bytesPerRow: 90,  compression: true,  cutting: true,  expanded: true,  modeSetting: true },
  "QL-800":    { bytesPerRow: 90,  compression: false, cutting: true,  expanded: true,  modeSetting: true },
  "QL-810W":   { bytesPerRow: 90,  compression: true,  cutting: true,  expanded: true,  modeSetting: true },
  "QL-820NWB": { bytesPerRow: 90,  compression: true,  cutting: true,  expanded: true,  modeSetting: true },
  "QL-1050":   { bytesPerRow: 162, compression: true,  cutting: true,  expanded: true,  modeSetting: true, extraOffset: 44 },
  "QL-1060N":  { bytesPerRow: 162, compression: true,  cutting: true,  expanded: true,  modeSetting: true, extraOffset: 44 },
};

// P-touch tape printers: 128-pin head at 180 dpi, compressed rows required.
export const PT_MODELS = {
  "PT-P700":   { pins: 128 },
  "PT-P710BT": { pins: 128 },
  "PT-P750W":  { pins: 128 },
};

export const MODELS = [
  ...Object.keys(QL_MODELS).map((id) => ({ id, family: "ql", ...QL_MODELS[id] })),
  ...Object.keys(PT_MODELS).map((id) => ({ id, family: "pt", ...PT_MODELS[id] })),
];

export function modelById(id) {
  return MODELS.find((model) => model.id === id) || MODELS.find((m) => m.id === "QL-800");
}

/* ---------- Labels ---------- */

// QL media, straight from brother_ql's label table. Rolls sit against one
// guide in the printer, so `offset` is measured from that edge — they are
// NOT centred, and centring them shifts the print off the label.
// printable is [across, along] in dots at 300 dpi; along = 0 means endless.
export const QL_LABELS = [
  { id: "62",     name: "62mm continuous",      dk: "DK-22205", kind: "endless", tape: [62, 0],   printable: [696, 0],     offset: 12, feed: 35 },
  { id: "54",     name: "54mm continuous",      dk: "DK-N55224", kind: "endless", tape: [54, 0],  printable: [590, 0],     offset: 0,  feed: 35 },
  { id: "50",     name: "50mm continuous",      dk: "DK-22223", kind: "endless", tape: [50, 0],   printable: [554, 0],     offset: 12, feed: 35 },
  { id: "38",     name: "38mm continuous",      dk: "DK-22225", kind: "endless", tape: [38, 0],   printable: [413, 0],     offset: 12, feed: 35 },
  { id: "29",     name: "29mm continuous",      dk: "DK-22210", kind: "endless", tape: [29, 0],   printable: [306, 0],     offset: 6,  feed: 35 },
  { id: "12",     name: "12mm continuous",      dk: "DK-22214", kind: "endless", tape: [12, 0],   printable: [106, 0],     offset: 29, feed: 35 },
  { id: "52x29",  name: "52 × 29mm die-cut",    kind: "diecut",  tape: [52, 29],  printable: [578, 271],   offset: 0,  feed: 0 },
  { id: "62x29",  name: "62 × 29mm die-cut",    dk: "DK-11209", kind: "diecut",  tape: [62, 29],  printable: [696, 271],   offset: 12, feed: 0 },
  { id: "62x100", name: "62 × 100mm die-cut",   dk: "DK-11202", kind: "diecut",  tape: [62, 100], printable: [696, 1109],  offset: 12, feed: 0 },
  { id: "29x90",  name: "29 × 90mm die-cut",    dk: "DK-11201", kind: "diecut",  tape: [29, 90],  printable: [306, 991],   offset: 6,  feed: 0 },
  { id: "39x90",  name: "38 × 90mm die-cut",    dk: "DK-11208", kind: "diecut",  tape: [39, 90],  printable: [413, 991],   offset: 12, feed: 0 },
  { id: "39x48",  name: "39 × 48mm die-cut",    kind: "diecut",  tape: [39, 48],  printable: [425, 495],   offset: 6,  feed: 0 },
  { id: "29x42",  name: "29 × 42mm die-cut",    kind: "diecut",  tape: [29, 42],  printable: [306, 425],   offset: 6,  feed: 0 },
  { id: "17x54",  name: "17 × 54mm die-cut",    dk: "DK-11204", kind: "diecut",  tape: [17, 54],  printable: [165, 566],   offset: 0,  feed: 0 },
  { id: "17x87",  name: "17 × 87mm die-cut",    dk: "DK-11203", kind: "diecut",  tape: [17, 87],  printable: [165, 956],   offset: 0,  feed: 0 },
  { id: "23x23",  name: "23 × 23mm die-cut",    kind: "diecut",  tape: [23, 23],  printable: [202, 202],   offset: 42, feed: 0 },
  { id: "102",    name: "102mm continuous",     dk: "DK-22243", kind: "endless", tape: [102, 0], printable: [1164, 0],    offset: 12, feed: 35, wide: true },
  { id: "102x51", name: "102 × 51mm die-cut",   kind: "diecut",  tape: [102, 51], printable: [1164, 526],  offset: 12, feed: 0, wide: true },
  { id: "102x152", name: "102 × 152mm die-cut", kind: "diecut",  tape: [102, 152], printable: [1164, 1660], offset: 12, feed: 0, wide: true },
];

// P-touch TZe tape: printable pins across the 128-pin head, centred, at
// 180 dpi. Figures from Brother's PT-P700/P750W raster command reference.
export const PT_LABELS = [
  { id: "tze-24",  name: "24mm TZe tape",  kind: "tape", tape: [24, 0],  pins: 128, margin: 0 },
  { id: "tze-18",  name: "18mm TZe tape",  kind: "tape", tape: [18, 0],  pins: 112, margin: 8 },
  { id: "tze-12",  name: "12mm TZe tape",  kind: "tape", tape: [12, 0],  pins: 70,  margin: 29 },
  { id: "tze-9",   name: "9mm TZe tape",   kind: "tape", tape: [9, 0],   pins: 50,  margin: 39 },
  { id: "tze-6",   name: "6mm TZe tape",   kind: "tape", tape: [6, 0],   pins: 32,  margin: 48 },
  { id: "tze-3.5", name: "3.5mm TZe tape", kind: "tape", tape: [3.5, 0], pins: 24,  margin: 52 },
];

export function labelsFor(model) {
  if (model.family === "pt") return PT_LABELS;
  const wide = model.bytesPerRow > 90;
  return QL_LABELS.filter((label) => wide || !label.wide);
}

export function labelById(model, id) {
  const options = labelsFor(model);
  return options.find((label) => label.id === id) || options[0];
}

// Dots per millimetre for a model family.
export function dpmm(model) {
  return model.family === "pt" ? 180 / 25.4 : 300 / 25.4;
}

/* ---------- PackBits (TIFF) — identical output to python-packbits ---------- */

export function packbits(data) {
  if (data.length === 0) return data;
  if (data.length === 1) return Uint8Array.of(0, data[0]);

  const result = [];
  let buf = [];
  let pos = 0;
  let repeat = 0;
  let state = "RAW";
  const MAX = 127;

  const finishRaw = () => {
    if (!buf.length) return;
    result.push(buf.length - 1, ...buf);
    buf = [];
  };
  const finishRle = () => {
    result.push(256 - (repeat - 1), data[pos]);
  };

  while (pos < data.length - 1) {
    const current = data[pos];
    if (data[pos] === data[pos + 1]) {
      if (state === "RAW") {
        finishRaw();
        state = "RLE";
        repeat = 1;
      } else {
        if (repeat === MAX) {
          finishRle();
          repeat = 0;
        }
        repeat += 1;
      }
    } else if (state === "RLE") {
      repeat += 1;
      finishRle();
      state = "RAW";
      repeat = 0;
    } else {
      if (buf.length === MAX) finishRaw();
      buf.push(current);
    }
    pos += 1;
  }

  if (state === "RAW") {
    buf.push(data[pos]);
    finishRaw();
  } else {
    repeat += 1;
    finishRle();
  }
  return Uint8Array.from(result);
}

/* ---------- Byte assembly ---------- */

class Bytes {
  constructor() { this.parts = []; this.length = 0; }
  push(...values) { this.add(Uint8Array.from(values)); }
  add(chunk) { this.parts.push(chunk); this.length += chunk.length; }
  zeros(count) { this.add(new Uint8Array(count)); }
  u32(value) { this.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff); }
  u16(value) { this.push(value & 0xff, (value >> 8) & 0xff); }
  done() {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const part of this.parts) { out.set(part, at); at += part.length; }
    return out;
  }
}

/* ---------- QL jobs ---------- */

// The bitmap must already be exactly label.printable wide (and, for die-cut
// labels, exactly that tall). thermal.js renders to that size.
export function qlRows(model, label, bitmap) {
  const lineBytes = model.bytesPerRow;
  const width = label.printable[0];
  const offset = label.offset + (model.extraOffset || 0);

  if (bitmap.width !== width) {
    throw new Error(`Bitmap is ${bitmap.width} dots wide; ${label.name} needs ${width}`);
  }
  if (label.kind === "diecut" && bitmap.height !== label.printable[1]) {
    throw new Error(`Bitmap is ${bitmap.height} dots long; ${label.name} needs ${label.printable[1]}`);
  }

  const rows = [];
  for (let y = 0; y < bitmap.height; y += 1) {
    const row = new Uint8Array(lineBytes);
    const base = y * width;
    for (let x = 0; x < width; x += 1) {
      if (!bitmap.data[base + x]) continue;
      // Placed `offset` dots from the guide edge, then mirrored, exactly as
      // brother_ql pastes and FLIP_LEFT_RIGHTs the image.
      const bit = offset + (width - 1 - x);
      row[bit >> 3] |= 0x80 >> (bit & 7);
    }
    rows.push(row);
  }
  return rows;
}

export function buildQLJob({ model, label, pages, cut = true, highQuality = true, compress }) {
  const useCompression = compress ?? model.compression;
  if (useCompression && !model.compression) {
    throw new Error(`${model.id} does not support compressed data`);
  }

  const out = new Bytes();
  const switchMode = () => { if (model.modeSetting) out.push(0x1b, 0x69, 0x61, 0x01); };

  switchMode();
  out.zeros(200);                 // invalidate: flush any half-finished job
  out.push(0x1b, 0x40);           // ESC @ initialise
  switchMode();                   // ESC i a 1: raster mode

  for (const bitmap of pages) {
    const rows = qlRows(model, label, bitmap);

    out.push(0x1b, 0x69, 0x53);   // ESC i S: status request

    // ESC i z: print information. Flags: recover | kind | width | length | quality.
    const flags = 0x80 | 0x02 | 0x04 | 0x08 | (highQuality ? 0x40 : 0);
    out.push(0x1b, 0x69, 0x7a, flags,
      label.kind === "diecut" ? 0x0b : 0x0a,
      label.tape[0] & 0xff,
      label.kind === "diecut" ? label.tape[1] & 0xff : 0);
    out.u32(rows.length);
    out.push(0x00, 0x00);         // starting page, fixed

    if (model.cutting && cut) {
      out.push(0x1b, 0x69, 0x4d, 0x40);  // ESC i M: auto cut
      out.push(0x1b, 0x69, 0x41, 0x01);  // ESC i A: cut every label
    }
    if (model.expanded) {
      out.push(0x1b, 0x69, 0x4b, cut ? 0x08 : 0x00); // ESC i K: cut at end
    }
    out.push(0x1b, 0x69, 0x64);   // ESC i d: feed margin
    out.u16(label.feed);
    if (useCompression) out.push(0x4d, 0x02); // M 02: TIFF/PackBits

    for (const row of rows) {
      const data = useCompression ? packbits(row) : row;
      out.push(0x67, 0x00, data.length);
      out.add(data);
    }
    out.push(0x1a);               // print with feed
  }
  return out.done();
}

/* ---------- P-touch jobs ---------- */

// Tape prints lengthwise: each raster line is one column of the label, laid
// across the head. The bitmap's height must equal the tape's printable pins.
export function ptRows(model, label, bitmap) {
  const lineBytes = model.pins / 8;
  if (bitmap.height !== label.pins) {
    throw new Error(`Bitmap is ${bitmap.height} dots tall; ${label.name} needs ${label.pins}`);
  }
  const rows = [];
  for (let x = 0; x < bitmap.width; x += 1) {
    const row = new Uint8Array(lineBytes);
    for (let y = 0; y < bitmap.height; y += 1) {
      if (!bitmap.data[y * bitmap.width + x]) continue;
      const bit = label.margin + y;
      row[bit >> 3] |= 0x80 >> (bit & 7);
    }
    rows.push(row);
  }
  return rows;
}

export function buildPTJob({ model, label, pages, cut = true }) {
  const out = new Bytes();
  out.zeros(100);                     // invalidate
  out.push(0x1b, 0x40);               // ESC @
  out.push(0x1b, 0x69, 0x61, 0x01);   // raster mode

  pages.forEach((bitmap, index) => {
    const rows = ptRows(model, label, bitmap);
    const last = index === pages.length - 1;

    out.push(0x1b, 0x69, 0x7a, 0x84, 0x00, Math.round(label.tape[0]) & 0xff, 0x00);
    out.u32(rows.length);
    out.push(index === 0 ? 0x00 : 0x01, 0x00);
    out.push(0x1b, 0x69, 0x4d, cut ? 0x40 : 0x00);  // auto cut
    out.push(0x1b, 0x69, 0x4b, 0x08);               // no chain: feed & cut last
    out.push(0x1b, 0x69, 0x64);                     // margin 2mm
    out.u16(14);
    out.push(0x4d, 0x02);                           // compression is required

    for (const row of rows) {
      if (row.every((value) => value === 0)) {
        out.push(0x5a);                             // Z: blank line
        continue;
      }
      const data = packbits(row);
      out.push(0x47);                               // G: raster line
      out.u16(data.length);
      out.add(data);
    }
    out.push(last ? 0x1a : 0x0c);
  });
  return out.done();
}

export function buildJob(options) {
  return options.model.family === "pt" ? buildPTJob(options) : buildQLJob(options);
}

/* ---------- Status ---------- */

// The 32-byte status reply (ESC i S), shared by QL and PT printers.
export const STATUS_REQUEST = (() => {
  const bytes = new Uint8Array(200 + 2 + 3);
  bytes.set([0x1b, 0x40], 200);
  bytes.set([0x1b, 0x69, 0x53], 202);
  return bytes;
})();

const ERRORS_1 = {
  0x01: "No label loaded",
  0x02: "The roll has run out",
  0x04: "The cutter is jammed",
  0x08: "The battery is weak",
  0x10: "The printer is busy",
  0x20: "The printer was switched off mid-job",
  0x40: "High-voltage adapter fault",
  0x80: "The fan has stopped",
};

const ERRORS_2 = {
  0x01: "Wrong label loaded for this job",
  0x02: "Expansion buffer full",
  0x04: "Communication error",
  0x08: "Communication buffer full",
  0x10: "The cover is open",
  0x20: "Cancelled",
  0x40: "Label could not be fed — check the roll is seated",
  0x80: "System error",
};

export function parseStatus(bytes) {
  if (!bytes || bytes.length < 32 || bytes[0] !== 0x80 || bytes[2] !== 0x42) return null;

  const errors = [];
  for (const [bit, text] of Object.entries(ERRORS_1)) if (bytes[8] & bit) errors.push(text);
  for (const [bit, text] of Object.entries(ERRORS_2)) if (bytes[9] & bit) errors.push(text);

  const mediaType = bytes[11];
  const kind = mediaType === 0x0b ? "diecut" : mediaType === 0x0a ? "endless" : mediaType ? "tape" : null;

  return {
    errors,
    width: bytes[10],
    length: bytes[17],
    kind,
    statusType: bytes[18],   // 0 reply, 1 printing done, 2 error, 6 phase change
    phase: bytes[19],
    done: bytes[18] === 0x01,
    failed: bytes[18] === 0x02 || errors.length > 0,
  };
}

// Picks the label definition that matches what the printer says is loaded.
export function matchLoaded(model, status) {
  if (!status || !status.width) return null;
  return labelsFor(model).find((label) => {
    if (Math.round(label.tape[0]) !== status.width) return false;
    if (model.family === "pt") return true;
    if (status.kind === "diecut") return label.kind === "diecut" && label.tape[1] === status.length;
    return label.kind === "endless";
  }) || null;
}
