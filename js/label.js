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

function canvasBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export function fileName(food) {
  const stem = food.name.replace(/[^\w -]/g, "").trim();
  return `${stem || "label"}.png`;
}

// Saving is layered, because a plain download link is blocked in an installed
// PWA and on iOS: share sheet first, then download, then open in a tab.
export async function saveLabel(food) {
  const blob = await canvasBlob(await safeCanvas(food));
  const name = fileName(food);
  const file = new File([blob], name, { type: "image/png" });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: food.name });
      return "shared";
    } catch (error) {
      if (error.name === "AbortError") return "cancelled";
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  if ("download" in link) {
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return "downloaded";
  }

  const tab = window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return tab ? "opened" : "blocked";
}

function printMarkup(food, src) {
  const title = food.name.replace(/[<&>]/g, "");
  return `<!doctype html><html><head><meta charset="utf-8">
    <title>${title}</title>
    <style>
      @page { size: auto; margin: 12mm; }
      html, body { margin: 0; height: 100%; }
      body { display: flex; align-items: center; justify-content: center; }
      img { width: 100%; max-width: 170mm; }
      @media screen { body { background: #f6f7f9; padding: 16px; } }
    </style></head>
    <body><img src="${src}" alt="${title}"></body></html>`;
}

// An installed PWA has no print UI of its own and iOS ignores iframe printing,
// so open a real tab when we can and fall back to the iframe.
export async function printLabel(food) {
  const png = await labelPng(food);
  const standalone = window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  if (standalone) {
    const tab = window.open("", "_blank");
    if (tab) {
      tab.document.write(printMarkup(food, png));
      tab.document.close();
      // The image is a data URL, so it is ready almost immediately.
      tab.addEventListener("load", () => tab.print());
      setTimeout(() => tab.print(), 700);
      return "tab";
    }
    // No tab available (iOS standalone): share the image so the system print
    // and save options are reachable from the share sheet.
    const shared = await saveLabel(food);
    if (shared === "shared" || shared === "cancelled") return shared;
  }

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.append(frame);

  frame.addEventListener("load", () => {
    const view = frame.contentWindow;
    view.focus();
    view.print();
    // Safari needs the frame to outlive the print dialog.
    setTimeout(() => frame.remove(), 60000);
  });

  frame.srcdoc = printMarkup(food, png);
  return "iframe";
}
