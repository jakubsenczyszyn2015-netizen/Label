#!/usr/bin/env node
// Label print bridge.
//
// Lets any device on your Wi-Fi — iPhones included — print to a Brother label
// printer that is plugged into, paired with, or on the same network as this
// computer. It also serves Label itself, so a phone can open it from here and
// talk to the bridge without the browser blocking the request.
//
//   node tools/print-bridge.mjs --printer <target> [--printer <target>…] [--port 8080]
//   node tools/print-bridge.mjs --list        # printers this computer can see
//
// Targets:
//   192.168.1.50                a network printer (raw TCP, port 9100)
//   /dev/usb/lp0                a USB printer on Linux
//   cups:Brother_QL_800         a CUPS queue on macOS or Linux, sent raw
//   \\localhost\QL800           a shared printer on Windows, sent raw
//   /dev/cu.PT-P710BT-xxxx      a Bluetooth printer paired with this Mac
//   /dev/rfcomm0                a Bluetooth printer bound on Linux
//   COM5                        a Bluetooth/serial printer on Windows
//
// Targets are fixed here at startup on purpose: the phone only picks one by
// name, so nobody on the network can point the bridge at another file or host.

import { createServer } from "node:http";
import { createReadStream, promises as fs, readdirSync } from "node:fs";
import { connect } from "node:net";
import { networkInterfaces, platform } from "node:os";
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const values = (name) => args.flatMap((arg, i) => (arg === `--${name}` ? [args[i + 1]] : []));
const PORT = Number(values("port")[0] || 8080);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW_PORT = 9100;
const MAX_JOB = 8 * 1024 * 1024;

/* ---------- Targets ---------- */

function parseTarget(spec, index) {
  const id = `p${index + 1}`;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(spec) || /^[a-z0-9.-]+\.local$/i.test(spec)) {
    return { id, kind: "tcp", host: spec, label: `${spec} (network)`, status: true };
  }
  if (spec.startsWith("cups:")) {
    return { id, kind: "cups", queue: spec.slice(5), label: `${spec.slice(5)} (this computer)`, status: false };
  }
  if (/^COM\d+$/i.test(spec)) {
    return { id, kind: "file", file: `\\\\.\\${spec.toUpperCase()}`, label: `${spec.toUpperCase()} (this computer)`, status: false };
  }
  if (spec.startsWith("/") || spec.startsWith("\\\\")) {
    const bluetooth = /rfcomm|cu\./i.test(spec);
    return {
      id, kind: "file", file: spec,
      label: `${path.basename(spec)} (${bluetooth ? "Bluetooth" : "USB"}, this computer)`,
      status: false,
    };
  }
  throw new Error(`Don't know how to reach "${spec}". Run with --list to see options.`);
}

/* ---------- Sending ---------- */

function sendTcp(host, bytes, readStatus = false) {
  return new Promise((resolve, reject) => {
    const reply = [];
    const socket = connect({ host, port: RAW_PORT });
    socket.setTimeout(10000);
    socket.on("connect", () => {
      socket.write(bytes);
      if (!readStatus) socket.end();
    });
    socket.on("data", (chunk) => {
      reply.push(chunk);
      if (readStatus && Buffer.concat(reply).length >= 32) socket.end();
    });
    socket.on("close", () => resolve(Buffer.concat(reply)));
    socket.on("timeout", () => {
      socket.destroy();
      if (readStatus) resolve(Buffer.concat(reply));
      else reject(new Error(`${host} did not answer on port ${RAW_PORT}`));
    });
    socket.on("error", reject);
  });
}

function sendCups(queue, bytes) {
  return new Promise((resolve, reject) => {
    const lp = spawn("lp", ["-d", queue, "-o", "raw"], { stdio: ["pipe", "ignore", "pipe"] });
    let error = "";
    lp.stderr.on("data", (chunk) => { error += chunk; });
    lp.on("error", reject);
    lp.on("close", (code) => (code === 0 ? resolve() : reject(new Error(error.trim() || `lp exited ${code}`))));
    lp.stdin.end(bytes);
  });
}

async function sendFile(file, bytes) {
  const handle = await fs.open(file, "w");
  try {
    await handle.write(bytes);
  } finally {
    await handle.close();
  }
}

function send(target, bytes) {
  if (target.kind === "tcp") return sendTcp(target.host, bytes);
  if (target.kind === "cups") return sendCups(target.queue, bytes);
  return sendFile(target.file, bytes);
}

// 200 nulls, ESC @, ESC i S — the printer answers with 32 status bytes.
const STATUS_REQUEST = Buffer.concat([Buffer.alloc(200), Buffer.from([0x1b, 0x40, 0x1b, 0x69, 0x53])]);

/* ---------- Discovery ---------- */

function list() {
  const found = [];
  const run = (cmd, argv) => {
    try { return execFileSync(cmd, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
    catch { return ""; }
  };

  if (platform() === "win32") {
    const out = run("powershell", ["-NoProfile", "-Command",
      "Get-Printer | Where-Object Name -like '*Brother*' | ForEach-Object { $_.Name + '|' + $_.ShareName + '|' + $_.Shared }"]);
    for (const row of out.split(/\r?\n/).filter(Boolean)) {
      const [name, share, shared] = row.split("|");
      found.push(shared === "True"
        ? `\\\\localhost\\${share}     ${name}`
        : `(not shared) ${name} — share it in Printer properties > Sharing, then use \\\\localhost\\<share name>`);
    }
    const ports = run("powershell", ["-NoProfile", "-Command",
      "Get-CimInstance Win32_SerialPort | ForEach-Object { $_.DeviceID + '|' + $_.Name }"]);
    for (const row of ports.split(/\r?\n/).filter(Boolean)) {
      const [id, name] = row.split("|");
      found.push(`${id}     ${name}`);
    }
  } else {
    for (const row of run("lpstat", ["-e"]).split("\n").filter(Boolean)) {
      found.push(`cups:${row}`);
    }
    for (const dir of ["/dev/usb", "/dev"]) {
      try {
        for (const name of readdirSync(dir)) {
          if (/^lp\d+$/.test(name) && dir === "/dev/usb") found.push(`${dir}/${name}`);
          if (dir === "/dev" && (/^rfcomm\d+$/.test(name) ||
            (/^cu\./.test(name) && !/Bluetooth-Incoming|debug-console|wlan/i.test(name)))) {
            found.push(`${dir}/${name}`);
          }
        }
      } catch { /* not present on this system */ }
    }
  }

  console.log(found.length
    ? `Printers this computer can reach:\n  ${found.join("\n  ")}`
    : "No printers found. A network printer can still be used by its IP address.");
  console.log("\nThen: node tools/print-bridge.mjs --printer <one of the above>");
}

if (args.includes("--list")) {
  list();
  process.exit(0);
}

const targets = values("printer").map(parseTarget);
if (!targets.length) {
  console.error("Give at least one --printer. Run with --list to see what this computer can reach.");
  process.exit(1);
}

/* ---------- Server ---------- */

const SERVED = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const json = (response, code, body) => {
  response.writeHead(code, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JOB) throw new Error("Print job too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://bridge");

  // Lets the hosted app (https) reach a bridge on this same computer.
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "content-type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (request.headers["access-control-request-private-network"]) {
    response.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/targets") {
    json(response, 200, { targets: targets.map(({ id, label, status }) => ({ id, label, status })) });
    return;
  }

  const target = targets.find((candidate) => candidate.id === url.searchParams.get("target"));

  if (url.pathname === "/status") {
    if (!target || target.kind !== "tcp") return json(response, 200, { status: null });
    try {
      const reply = await sendTcp(target.host, STATUS_REQUEST, true);
      json(response, 200, { status: reply.length >= 32 ? [...reply.subarray(0, 32)] : null });
    } catch (error) {
      json(response, 502, { error: error.message });
    }
    return;
  }

  if (url.pathname === "/print" && request.method === "POST") {
    if (!target) return json(response, 400, { error: "Unknown printer" });
    try {
      const bytes = await readBody(request);
      await send(target, bytes);
      console.log(`printed ${bytes.length} bytes -> ${target.label}`);
      json(response, 200, { sent: bytes.length });
    } catch (error) {
      console.error(`print failed (${target.label}):`, error.message);
      json(response, 502, { error: error.message });
    }
    return;
  }

  // Everything else is the app itself.
  // Only the app's own files: no dot-files (.git), no tools, no source maps of
  // anything else that happens to sit in the folder.
  let wanted;
  try {
    wanted = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }
  const file = path.resolve(ROOT, `.${path.posix.normalize(wanted)}`);
  const segments = path.relative(ROOT, file).split(path.sep);
  const allowed = file.startsWith(ROOT + path.sep) &&
    !segments.some((segment) => segment.startsWith(".")) &&
    !["tools", "node_modules"].includes(segments[0]) &&
    Object.hasOwn(SERVED, path.extname(file));
  if (!allowed) {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error("not a file");
    response.writeHead(200, {
      "content-type": SERVED[path.extname(file)],
      "cache-control": "no-cache",
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

server.listen(PORT, () => {
  const addresses = Object.values(networkInterfaces()).flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);

  console.log("Label print bridge is running.\n");
  console.log("On this computer:   http://localhost:" + PORT);
  for (const address of addresses) console.log(`On your phone:      http://${address}:${PORT}`);
  console.log("\nPrinters:");
  for (const target of targets) console.log(`  ${target.label}`);
});
