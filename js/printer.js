// Getting bytes to a Brother printer, and hearing back from it.
//
// Transports, best first for each situation:
//   USB          WebUSB — Chrome/Edge on a computer or Android (OTG cable).
//   Bluetooth    Web Serial over classic Bluetooth (SPP), which is what
//                Brother's Bluetooth printers speak. Chrome/Edge on desktop,
//                recent Chrome on Android. Pair the printer in the OS first.
//   Bluetooth LE Web Bluetooth, for the few printers that use BLE.
//   Bridge       tools/print-bridge.mjs on a computer — reaches network
//                printers and anything plugged into that computer, from any
//                device including iPhones.
//
// No iOS browser offers USB, serial or Bluetooth access, so on an iPhone the
// options are the bridge, or handing a label-sized PDF to the Brother app.

import {
  buildJob, parseStatus, matchLoaded, STATUS_REQUEST,
} from "./raster.js";

const BROTHER = 0x04f9;
const SPP = "00001101-0000-1000-8000-00805f9b34fb";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class PrinterError extends Error {
  constructor(message, { hint, loaded } = {}) {
    super(message);
    this.hint = hint;
    this.loaded = loaded;
  }
}

/* ---------- USB ---------- */

class UsbPrinter {
  constructor(device) {
    this.device = device;
    this.kind = "usb";
    this.name = device.productName || "Brother USB printer";
    this.canStatus = true;
    this.buffer = [];
    this.pending = null;
  }

  static async request() {
    return new UsbPrinter(await navigator.usb.requestDevice({ filters: [{ vendorId: BROTHER }] }));
  }

  static async remembered() {
    const devices = await navigator.usb.getDevices();
    const device = devices.find((candidate) => candidate.vendorId === BROTHER);
    return device ? new UsbPrinter(device) : null;
  }

  async open() {
    const device = this.device;
    if (!device.opened) await device.open();
    if (!device.configuration) await device.selectConfiguration(1);

    const interfaces = device.configuration.interfaces;
    const iface = interfaces.find((candidate) =>
      candidate.alternates.some((alt) => alt.interfaceClass === 7));

    if (!iface) {
      const storage = interfaces.some((candidate) =>
        candidate.alternates.some((alt) => alt.interfaceClass === 8));
      throw new PrinterError(storage
        ? "The printer is in Editor Lite mode, so it's acting as a USB drive."
        : "That device has no printer interface.", {
        hint: storage
          ? "Hold the Editor Lite button until its green light goes out, then connect again."
          : "Make sure you picked the Brother label printer.",
      });
    }

    const alt = iface.alternates.find((candidate) => candidate.interfaceClass === 7);
    try {
      await device.claimInterface(iface.interfaceNumber);
    } catch (error) {
      throw new PrinterError("Your computer's printer driver is holding the printer.", {
        hint: "On Windows, either use the print bridge, or switch the printer to the " +
          "WinUSB driver with Zadig. On Linux, unload the usblp module. " +
          `(${error.message})`,
      });
    }
    if (alt.alternateSetting) {
      await device.selectAlternateInterface(iface.interfaceNumber, alt.alternateSetting);
    }

    this.interfaceNumber = iface.interfaceNumber;
    this.out = alt.endpoints.find((endpoint) => endpoint.direction === "out").endpointNumber;
    this.in = alt.endpoints.find((endpoint) => endpoint.direction === "in")?.endpointNumber;
    if (!this.in) this.canStatus = false;
  }

  async send(bytes) {
    for (let at = 0; at < bytes.length; at += 16384) {
      const result = await this.device.transferOut(this.out, bytes.subarray(at, at + 16384));
      if (result.status !== "ok") throw new PrinterError(`USB transfer ${result.status}`);
    }
  }

  // Reads one 32-byte status packet. An unanswered transferIn cannot be
  // cancelled, so it is kept and reused by the next read.
  async readStatus(timeout = 3000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (this.buffer.length >= 32) {
        const packet = this.buffer.splice(0, 32);
        const status = parseStatus(Uint8Array.from(packet));
        if (status) return status;
        continue;
      }
      this.pending ||= this.device.transferIn(this.in, 64);
      const result = await Promise.race([this.pending, sleep(Math.max(0, deadline - Date.now()))]);
      if (!result) break;
      this.pending = null;
      if (result.data?.byteLength) {
        this.buffer.push(...new Uint8Array(result.data.buffer));
      } else {
        await sleep(60);
      }
    }
    return null;
  }

  async close() {
    try {
      await this.device.releaseInterface(this.interfaceNumber);
      await this.device.close();
    } catch { /* already gone */ }
  }
}

/* ---------- Classic Bluetooth / serial ---------- */

class SerialPrinter {
  constructor(port) {
    this.port = port;
    this.kind = "bluetooth";
    const info = port.getInfo?.() || {};
    this.name = info.bluetoothServiceClassId ? "Brother Bluetooth printer" : "Serial printer";
    this.canStatus = true;
    this.buffer = [];
  }

  static async request() {
    const port = await navigator.serial.requestPort({ allowedBluetoothServiceClassIds: [SPP] });
    return new SerialPrinter(port);
  }

  static async remembered() {
    const ports = await navigator.serial.getPorts();
    return ports.length ? new SerialPrinter(ports[0]) : null;
  }

  async open() {
    if (this.port.readable || this.port.writable) return;
    try {
      // The baud rate is ignored over Bluetooth but required by the API.
      await this.port.open({ baudRate: 115200 });
    } catch (error) {
      throw new PrinterError("Couldn't open the Bluetooth connection.", {
        hint: "Check the printer is on and paired in your computer's Bluetooth " +
          `settings, and not connected to another phone. (${error.message})`,
      });
    }
  }

  async send(bytes) {
    const writer = this.port.writable.getWriter();
    try {
      // Paced, so the printer's small Bluetooth buffer never overflows.
      for (let at = 0; at < bytes.length; at += 2048) {
        await writer.write(bytes.subarray(at, at + 2048));
      }
    } finally {
      writer.releaseLock();
    }
  }

  async readStatus(timeout = 3000) {
    const reader = this.port.readable.getReader();
    const timer = setTimeout(() => reader.cancel().catch(() => {}), timeout);
    try {
      while (this.buffer.length < 32) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) this.buffer.push(...value);
      }
    } catch { /* timed out */ } finally {
      clearTimeout(timer);
      reader.releaseLock();
    }
    if (this.buffer.length < 32) return null;
    return parseStatus(Uint8Array.from(this.buffer.splice(0, 32)));
  }

  async close() {
    try { await this.port.close(); } catch { /* already gone */ }
  }
}

/* ---------- Bluetooth LE ---------- */

class BlePrinter {
  constructor(device) {
    this.device = device;
    this.kind = "ble";
    this.name = device.name || "Bluetooth LE printer";
    this.canStatus = false;
  }

  static async request() {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [
        "000018f0-0000-1000-8000-00805f9b34fb",
        "0000fe60-0000-1000-8000-00805f9b34fb",
        "0000ffe0-0000-1000-8000-00805f9b34fb",
        "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
      ],
    });
    return new BlePrinter(device);
  }

  async open() {
    const server = await this.device.gatt.connect();
    for (const service of await server.getPrimaryServices()) {
      for (const characteristic of await service.getCharacteristics()) {
        if (characteristic.properties.write || characteristic.properties.writeWithoutResponse) {
          this.characteristic = characteristic;
          return;
        }
      }
    }
    throw new PrinterError("That device has no channel to print on.", {
      hint: "Most Brother Bluetooth printers use classic Bluetooth — try “Bluetooth” instead.",
    });
  }

  async send(bytes) {
    for (let at = 0; at < bytes.length; at += 180) {
      const chunk = bytes.subarray(at, at + 180);
      if (this.characteristic.properties.writeWithoutResponse) {
        await this.characteristic.writeValueWithoutResponse(chunk);
      } else {
        await this.characteristic.writeValue(chunk);
      }
    }
  }

  async close() {
    try { this.device.gatt.disconnect(); } catch { /* already gone */ }
  }
}

/* ---------- Print bridge ---------- */

// An https page may call http://localhost (the browser trusts it) but not an
// http address elsewhere on the network.
export function bridgeBlocked(bridge) {
  if (location.protocol !== "https:") return false;
  try {
    const url = new URL(bridge);
    if (url.protocol === "https:") return false;
    return !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return true;
  }
}

export function defaultBridge() {
  return localStorage.getItem("label.bridge") ||
    (location.protocol === "http:" ? location.origin : "http://localhost:8080");
}

export async function bridgeTargets(bridge) {
  const response = await fetch(`${bridge.replace(/\/$/, "")}/targets`, { cache: "no-store" });
  if (!response.ok) throw new PrinterError("The print bridge did not answer.");
  return (await response.json()).targets || [];
}

class BridgePrinter {
  constructor(bridge, target) {
    this.bridge = bridge.replace(/\/$/, "");
    this.target = target;
    this.kind = "bridge";
    this.name = target.label;
    this.canStatus = Boolean(target.status);
  }

  async open() {
    const response = await fetch(`${this.bridge}/targets`, { cache: "no-store" });
    if (!response.ok) throw new PrinterError("The print bridge did not answer.");
  }

  async send(bytes) {
    const response = await fetch(`${this.bridge}/print?target=${encodeURIComponent(this.target.id)}`, {
      method: "POST",
      body: bytes,
      headers: { "content-type": "application/octet-stream" },
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new PrinterError(detail.error || `The bridge returned ${response.status}`);
    }
  }

  async readStatus(timeout = 4000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(
        `${this.bridge}/status?target=${encodeURIComponent(this.target.id)}`,
        { cache: "no-store", signal: controller.signal });
      if (!response.ok) return null;
      const { status } = await response.json();
      return status ? parseStatus(Uint8Array.from(status)) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async close() { /* stateless */ }
}

/* ---------- Connection ---------- */

let connected = null;

export function currentPrinter() {
  return connected;
}

export function transports() {
  return {
    usb: Boolean(navigator.usb),
    bluetooth: Boolean(navigator.serial),
    ble: Boolean(navigator.bluetooth),
    bridge: true,
  };
}

export async function connectPrinter(kind, options = {}) {
  await disconnectPrinter();

  let printer;
  if (kind === "usb") {
    if (!navigator.usb) throw new PrinterError("This browser has no USB access.");
    printer = await UsbPrinter.request();
  } else if (kind === "bluetooth") {
    if (!navigator.serial) throw new PrinterError("This browser has no Bluetooth serial access.");
    printer = await SerialPrinter.request();
  } else if (kind === "ble") {
    if (!navigator.bluetooth) throw new PrinterError("This browser has no Bluetooth LE access.");
    printer = await BlePrinter.request();
  } else if (kind === "bridge") {
    if (bridgeBlocked(options.bridge)) {
      throw new PrinterError("This page can't reach that bridge.", {
        hint: "Open Label from the bridge's own address, or run the bridge on this computer and use http://localhost:8080.",
      });
    }
    printer = new BridgePrinter(options.bridge, options.target);
  }

  await printer.open();
  connected = printer;
  localStorage.setItem("label.transport", kind);
  return printer;
}

// Reconnects to a printer this browser was already allowed to use, without
// showing the chooser again.
export async function reconnect() {
  const kind = localStorage.getItem("label.transport");
  try {
    let printer = null;
    if (kind === "usb" && navigator.usb) printer = await UsbPrinter.remembered();
    if (kind === "bluetooth" && navigator.serial) printer = await SerialPrinter.remembered();
    if (!printer) return null;
    await printer.open();
    connected = printer;
    return printer;
  } catch {
    return null;
  }
}

export async function disconnectPrinter() {
  await connected?.close();
  connected = null;
}

/* ---------- Status & printing ---------- */

export async function queryStatus() {
  if (!connected?.canStatus) return null;
  if (connected.kind !== "bridge") await connected.send(STATUS_REQUEST);
  return connected.readStatus(3000);
}

// Checks the printer is ready and holds the label the job was laid out for.
// A mismatch is the usual reason a Brother printer blinks red and prints
// nothing, so it is caught here instead.
export async function preflight(model, label) {
  const status = await queryStatus().catch(() => null);
  if (!status) return { checked: false };

  if (status.errors.length) {
    throw new PrinterError(status.errors.join(". "), {
      hint: "Fix that on the printer, then print again.",
    });
  }

  const loaded = matchLoaded(model, status);
  if (loaded && loaded.id !== label.id) {
    throw new PrinterError(`The printer has ${loaded.name} loaded, not ${label.name}.`, {
      hint: "Switch to the loaded label, or change the roll.",
      loaded,
    });
  }
  return { checked: true, loaded, status };
}

export async function printBitmap({ model, label, bitmap, copies = 1, cut = true, check = true }) {
  if (!connected) throw new PrinterError("No printer connected.");

  const pre = check ? await preflight(model, label) : { checked: false };
  const job = buildJob({ model, label, pages: Array(copies).fill(bitmap), cut });
  await connected.send(job);

  // Wait for the printer to report the job finished (or why it didn't).
  let confirmed = false;
  if (connected.canStatus && connected.kind !== "bridge") {
    const deadline = Date.now() + 8000 + copies * 4000;
    let finished = 0;
    while (Date.now() < deadline && finished < copies) {
      const status = await connected.readStatus(Math.min(4000, deadline - Date.now()));
      if (!status) continue;
      if (status.errors.length) {
        throw new PrinterError(status.errors.join(". "), { hint: "Fix that on the printer, then print again." });
      }
      if (status.done) finished += 1;
    }
    confirmed = finished >= copies;
  }

  return { bytes: job.length, checked: pre.checked, confirmed };
}
