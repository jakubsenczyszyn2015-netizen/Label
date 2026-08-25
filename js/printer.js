// Direct printing to a label printer, without the OS print dialog.
//
// Browsers cannot open raw network sockets, so a web app can only reach a
// printer over WebUSB or Web Bluetooth. Both exist in Chrome/Edge on desktop
// and Android; neither exists in any iOS browser, so iPhones and iPads fall
// back to the share sheet. What goes down the wire is Brother's raster
// protocol, which QL and P-touch models speak natively.

const BROTHER_VENDOR = 0x04f9;

// Bytes per raster line = printable dots / 8. Values come from Brother's
// raster command reference for each media size.
export const MEDIA = [
  { id: "ql-62", label: "QL continuous 62mm", bytes: 90, dots: 720, type: 0x0a, width: 62 },
  { id: "ql-29", label: "QL continuous 29mm", bytes: 36, dots: 288, type: 0x0a, width: 29 },
  { id: "pt-24", label: "P-touch tape 24mm", bytes: 16, dots: 128, type: 0x00, width: 24 },
  { id: "pt-12", label: "P-touch tape 12mm", bytes: 16, dots: 128, type: 0x00, width: 12 },
];

export function mediaById(id) {
  return MEDIA.find((entry) => entry.id === id) || MEDIA[0];
}

export function printingSupported() {
  return Boolean(navigator.usb || navigator.bluetooth);
}

/* ---------- Raster encoding ---------- */

// Scales the label to the printer's dot width and turns it into 1-bit rows.
function toBitmap(canvas, media) {
  const width = media.dots;
  const height = Math.max(1, Math.round((canvas.height / canvas.width) * width));

  const scaled = document.createElement("canvas");
  scaled.width = width;
  scaled.height = height;
  const ctx = scaled.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(canvas, 0, 0, width, height);

  const { data } = ctx.getImageData(0, 0, width, height);
  const rows = [];

  for (let y = 0; y < height; y += 1) {
    const row = new Uint8Array(media.bytes);
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      // Simple luminance threshold: thermal printers are pure black/white.
      const lit = (data[at] * 0.299 + data[at + 1] * 0.587 + data[at + 2] * 0.114) < 128;
      if (lit) row[x >> 3] |= 0x80 >> (x & 7);
    }
    rows.push(row);
  }
  return rows;
}

export async function encodeLabel(canvas, media, copies = 1) {
  const rows = toBitmap(canvas, media);
  const out = [];
  const push = (...bytes) => out.push(...bytes);

  push(...new Array(200).fill(0x00)); // clear any half-finished job
  push(0x1b, 0x40);                   // initialise
  push(0x1b, 0x69, 0x61, 0x01);       // raster command mode

  for (let copy = 0; copy < copies; copy += 1) {
    const count = rows.length;
    // Print information: media type, width, length, raster count.
    push(0x1b, 0x69, 0x7a, 0x86, media.type, media.width, 0x00,
      count & 0xff, (count >> 8) & 0xff, (count >> 16) & 0xff, (count >> 24) & 0xff,
      copy === 0 ? 0x00 : 0x01, 0x00);

    push(0x1b, 0x69, 0x4d, 0x40);       // auto cut on
    push(0x1b, 0x69, 0x41, 0x01);       // cut every copy
    push(0x1b, 0x69, 0x64, 0x23, 0x00); // feed margin
    push(0x4d, 0x00);                   // no compression

    for (const row of rows) {
      push(0x67, 0x00, media.bytes, ...row);
    }

    // 0x0C ends a page mid-job; 0x1A ends the last one and feeds.
    push(copy === copies - 1 ? 0x1a : 0x0c);
  }

  return new Uint8Array(out);
}

/* ---------- Transports ---------- */

class UsbPrinter {
  constructor(device) {
    this.device = device;
    this.name = device.productName || "USB label printer";
  }

  static async request() {
    const device = await navigator.usb.requestDevice({
      filters: [{ vendorId: BROTHER_VENDOR }],
    });
    return new UsbPrinter(device);
  }

  async open() {
    const device = this.device;
    await device.open();
    if (!device.configuration) await device.selectConfiguration(1);

    const iface = device.configuration.interfaces.find((candidate) =>
      candidate.alternate.interfaceClass === 7); // 7 = printer class
    if (!iface) throw new Error("That device has no printer interface");

    await device.claimInterface(iface.interfaceNumber);
    this.interfaceNumber = iface.interfaceNumber;
    this.endpoint = iface.alternate.endpoints
      .find((candidate) => candidate.direction === "out").endpointNumber;
  }

  async send(bytes) {
    // Chunked, because a long label can exceed the driver's transfer buffer.
    for (let at = 0; at < bytes.length; at += 4096) {
      await this.device.transferOut(this.endpoint, bytes.slice(at, at + 4096));
    }
  }

  async close() {
    try {
      await this.device.releaseInterface(this.interfaceNumber);
      await this.device.close();
    } catch { /* already gone */ }
  }
}

class BluetoothPrinter {
  constructor(device, characteristic) {
    this.device = device;
    this.characteristic = characteristic;
    this.name = device.name || "Bluetooth label printer";
  }

  static async request() {
    // Brother's BLE serial service; the optional entries cover printers that
    // expose a generic serial port instead.
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: "PT-" }, { namePrefix: "QL-" }, { namePrefix: "Brother" },
      ],
      optionalServices: [
        "000018f0-0000-1000-8000-00805f9b34fb",
        "0000fe60-0000-1000-8000-00805f9b34fb",
      ],
    });
    return new BluetoothPrinter(device, null);
  }

  async open() {
    const server = await this.device.gatt.connect();
    const services = await server.getPrimaryServices();

    for (const service of services) {
      const characteristics = await service.getCharacteristics();
      const writable = characteristics.find((candidate) =>
        candidate.properties.write || candidate.properties.writeWithoutResponse);
      if (writable) {
        this.characteristic = writable;
        return;
      }
    }
    throw new Error("No writable channel on that printer");
  }

  async send(bytes) {
    // BLE writes are capped at roughly one MTU, so keep packets small.
    for (let at = 0; at < bytes.length; at += 180) {
      const chunk = bytes.slice(at, at + 180);
      if (this.characteristic.writeValueWithoutResponse) {
        await this.characteristic.writeValueWithoutResponse(chunk);
      } else {
        await this.characteristic.writeValue(chunk);
      }
    }
  }

  async close() {
    try {
      this.device.gatt.disconnect();
    } catch { /* already gone */ }
  }
}

let connected = null;

export function currentPrinter() {
  return connected;
}

export async function connectPrinter(kind) {
  if (kind === "bluetooth") {
    if (!navigator.bluetooth) throw new Error("This browser has no Bluetooth access");
    connected = await BluetoothPrinter.request();
  } else {
    if (!navigator.usb) throw new Error("This browser has no USB access");
    connected = await UsbPrinter.request();
  }
  await connected.open();
  return connected;
}

export async function disconnectPrinter() {
  await connected?.close();
  connected = null;
}

export async function printToPrinter(canvas, mediaId, copies) {
  if (!connected) throw new Error("No printer connected");
  const media = mediaById(mediaId);
  await connected.send(await encodeLabel(canvas, media, copies));
  return "printed";
}
