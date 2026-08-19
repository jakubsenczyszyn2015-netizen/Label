import { jpegToPdf } from "./pdf.js";

// Renders a food as a printable label, either to a canvas (for a PNG) or to
// print-ready HTML (which the browser can save as a PDF).

const WIDTH = 780;
const HEIGHT = 900; // drawing space; the label is trimmed to its content
const MIN_HEIGHT = 360;
const PAD = 44;

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    // Remote pictures need CORS headers or the canvas becomes unexportable.
    if (!src.startsWith("data:")) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrap(ctx, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function formatDate(value) {
  if (!value) return "";
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric", month: "long", year: "numeric",
  });
}

export async function drawLabel(food) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "#5c9bd1";
  ctx.fillRect(0, 0, WIDTH, 14);

  const picture = await loadImage(food.image_url);
  const textWidth = picture ? WIDTH - PAD * 2 - 190 : WIDTH - PAD * 2;

  if (picture) {
    const size = 170;
    const x = WIDTH - PAD - size;
    const y = PAD + 6;
    const crop = Math.min(picture.width, picture.height);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, 16);
    ctx.clip();
    ctx.drawImage(
      picture,
      (picture.width - crop) / 2, (picture.height - crop) / 2, crop, crop,
      x, y, size, size,
    );
    ctx.restore();
  }

  let y = PAD + 40;

  ctx.fillStyle = "#1b1e22";
  ctx.font = "bold 44px -apple-system, Segoe UI, Helvetica, Arial, sans-serif";
  for (const line of wrap(ctx, food.name, textWidth).slice(0, 2)) {
    ctx.fillText(line, PAD, y);
    y += 52;
  }

  y += 6;
  ctx.font = "26px -apple-system, Segoe UI, Helvetica, Arial, sans-serif";
  ctx.fillStyle = "#5a6169";
  ctx.fillText(`Best before ${formatDate(food.expires_on)}`, PAD, y);
  y += 38;

  if (food.description) {
    ctx.font = "22px -apple-system, Segoe UI, Helvetica, Arial, sans-serif";
    ctx.fillStyle = "#8a9199";
    for (const line of wrap(ctx, food.description, textWidth).slice(0, 2)) {
      ctx.fillText(line, PAD, y);
      y += 30;
    }
  }

  const allergens = food.allergens || [];
  y = Math.max(y + 30, picture ? PAD + 220 : y + 30);

  ctx.font = "bold 20px -apple-system, Segoe UI, Helvetica, Arial, sans-serif";
  ctx.fillStyle = "#1b1e22";
  ctx.fillText(allergens.length ? "CONTAINS" : "NO DECLARED ALLERGENS", PAD, y);
  y += 34;

  if (allergens.length) {
    ctx.font = "22px -apple-system, Segoe UI, Helvetica, Arial, sans-serif";
    let x = PAD;
    for (const allergen of allergens) {
      const width = ctx.measureText(allergen).width + 26;
      if (x + width > WIDTH - PAD) {
        x = PAD;
        y += 44;
      }
      ctx.fillStyle = "#fbecec";
      ctx.beginPath();
      ctx.roundRect(x, y - 24, width, 34, 17);
      ctx.fill();
      ctx.fillStyle = "#cf5c5c";
      ctx.fillText(allergen, x + 13, y);
      x += width + 10;
    }
  }

  // Trim to the height actually used, then redraw the border to fit.
  const height = Math.max(MIN_HEIGHT, y + PAD);
  const label = document.createElement("canvas");
  label.width = WIDTH;
  label.height = height;
  const out = label.getContext("2d");
  out.fillStyle = "#ffffff";
  out.fillRect(0, 0, WIDTH, height);
  out.drawImage(canvas, 0, 0);
  out.strokeStyle = "#d8dde2";
  out.lineWidth = 2;
  out.strokeRect(1, 1, WIDTH - 2, height - 2);
  return label;
}

async function safeCanvas(food) {
  const canvas = await drawLabel(food);
  try {
    canvas.getContext("2d").getImageData(0, 0, 1, 1);
    return canvas;
  } catch {
    // A remote picture without CORS headers taints the canvas; retry without it.
    return drawLabel({ ...food, image_url: null });
  }
}

export async function labelPng(food) {
  return (await safeCanvas(food)).toDataURL("image/png");
}

function dataUrlBytes(dataUrl) {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function labelName(food, extension) {
  const stem = food.name.replace(/[^\w -]/g, "").trim();
  return `${stem || "label"}.${extension}`;
}

async function labelFile(food, kind) {
  const canvas = await safeCanvas(food);

  if (kind === "pdf") {
    const jpeg = dataUrlBytes(canvas.toDataURL("image/jpeg", 0.92));
    const blob = jpegToPdf(jpeg, canvas.width, canvas.height);
    return new File([blob], labelName(food, "pdf"), { type: "application/pdf" });
  }

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return new File([blob], labelName(food, "png"), { type: "image/png" });
}

// Hands the label to the system share sheet, which is where Brother
// iPrint&Label, P-touch Design&Print, Dymo and AirPrint all appear.
export async function shareLabel(food, kind) {
  const file = await labelFile(food, kind);

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: food.name });
      return "shared";
    } catch (error) {
      if (error.name === "AbortError") return "cancelled";
      // Fall through to saving if the share sheet refused the file.
    }
  }
  return saveFile(file);
}

// Saving never navigates away, so cancelling a save cannot strand the app.
export function saveFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");

  if ("download" in link) {
    link.href = url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return "saved";
  }

  const tab = window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return tab ? "opened" : "blocked";
}

export async function saveLabel(food, kind) {
  return saveFile(await labelFile(food, kind));
}

// Printing uses a hidden frame: it never replaces the app, so cancelling the
// print dialog leaves you exactly where you were.
export async function printLabel(food) {
  const png = await labelPng(food);
  const title = food.name.replace(/[<&>]/g, "");

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.append(frame);

  frame.addEventListener("load", () => {
    const view = frame.contentWindow;
    view.focus();
    view.print();
    setTimeout(() => frame.remove(), 60000);
  });

  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8">
    <title>${title}</title>
    <style>
      @page { size: auto; margin: 10mm; }
      html, body { margin: 0; height: 100%; }
      body { display: flex; align-items: center; justify-content: center; }
      img { width: 100%; max-width: 170mm; }
    </style></head>
    <body><img src="${png}" alt="${title}"></body></html>`;

  return "printing";
}
