#!/usr/bin/env node
// Wi-Fi printing bridge.
//
// Browsers cannot open a raw TCP socket, and Brother network printers listen
// for raw jobs on port 9100. This serves Label over plain HTTP on your network
// and forwards print jobs to the printer, so any device on the same Wi-Fi —
// iPhones included — can print without an app in the middle.
//
//   node tools/print-bridge.mjs [--port 8080] [--printer 192.168.1.50]
//
// Then open http://<this-computer's-ip>:8080 on the phone.

import { createServer } from "node:http";
import { createReadStream, promises as fs } from "node:fs";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};

const PORT = Number(flag("port", 8080));
const DEFAULT_PRINTER = flag("printer", "");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PRINTER_PORT = 9100;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".sql": "text/plain; charset=utf-8",
};

function sendRaw(host, bytes) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port: PRINTER_PORT, timeout: 10000 });
    socket.on("connect", () => socket.end(bytes));
    socket.on("close", () => resolve());
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error(`${host} did not answer on port ${PRINTER_PORT}`));
    });
    socket.on("error", (error) => reject(error));
  });
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  // Same-origin, so the browser never blocks it as mixed content.
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "content-type");

  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/bridge") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ bridge: true, printer: DEFAULT_PRINTER }));
    return;
  }

  if (url.pathname === "/print" && request.method === "POST") {
    const host = url.searchParams.get("host") || DEFAULT_PRINTER;
    if (!host) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "No printer address given" }));
      return;
    }
    try {
      const bytes = await readBody(request);
      await sendRaw(host, bytes);
      console.log(`sent ${bytes.length} bytes to ${host}`);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ sent: bytes.length, printer: host }));
    } catch (error) {
      console.error("print failed:", error.message);
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // Everything else is the app itself.
  const wanted = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = path.join(ROOT, path.normalize(wanted).replace(/^(\.\.[/\\])+/, ""));

  if (!file.startsWith(ROOT)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    await fs.access(file);
    response.writeHead(200, {
      "content-type": TYPES[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

server.listen(PORT, () => {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);

  console.log("Label print bridge running.");
  for (const address of addresses) console.log(`  http://${address}:${PORT}`);
  if (DEFAULT_PRINTER) console.log(`  printer: ${DEFAULT_PRINTER}:${PRINTER_PORT}`);
  else console.log("  no default printer — set one in the app's print sheet");
});
