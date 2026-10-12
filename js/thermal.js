// Renders a food label for a thermal label printer: pure black on white,
// drawn directly at the printer's dot grid (300 dpi for QL, 180 dpi for
// P-touch), sized to the exact printable area of the chosen label.
//
// Nothing is scaled after rendering, so what the preview shows is dot for
// dot what the printer lays down — and what the Brother app receives.

import { dpmm } from "./raster.js";

const FONT = '"Helvetica Neue", Helvetica, Arial, "Segoe UI", Roboto, sans-serif';
const INK_THRESHOLD = 180;  // luminance below this prints; matches brother_ql's 70%

/* ---------- Small helpers ---------- */

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// "01 SEP 2026" — no day/month ambiguity whoever reads it.
export function labelDate(value) {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  return `${String(day).padStart(2, "0")} ${MONTHS[month - 1]} ${year}`;
}

function setFont(ctx, weight, size) {
  ctx.font = `${weight} ${Math.max(6, Math.round(size))}px ${FONT}`;
}

// Word wrap to maxLines, breaking over-long words, ellipsising the overflow.
function wrap(ctx, text, width, maxLines) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  const pushLongWord = (word) => {
    let part = "";
    for (const char of word) {
      if (ctx.measureText(part + char).width > width && part) {
        lines.push(part);
        part = char;
      } else {
        part += char;
      }
    }
    return part;
  };

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width) {
      line = next;
    } else if (!line) {
      line = pushLongWord(word);
    } else {
      lines.push(line);
      line = ctx.measureText(word).width > width ? pushLongWord(word) : word;
    }
  }
  if (line) lines.push(line);

  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last.trimEnd()}…`;
    return kept;
  }
  return lines;
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    if (!src.startsWith("data:")) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Binary search for the largest scale whose layout fits the limit.
function fitScale(measure, limit, low = 0.25, high = 1.5) {
  if (measure(low) > limit) return low;
  for (let i = 0; i < 18; i += 1) {
    const mid = (low + high) / 2;
    if (measure(mid) <= limit) low = mid; else high = mid;
  }
  return low;
}

/* ---------- Layouts ---------- */

// The standard label: name, rule, best-before, description, allergen box.
// Returns the height used. With draw=false it only measures.
function blockLayout(ctx, food, width, scale, opts, draw) {
  const u = opts.dpmm;
  const s = scale;
  const pad = Math.round(u * Math.max(1.2, 1.8 * Math.min(s, 1)));
  const inner = width - pad * 2;
  const line = Math.max(2, Math.round(0.45 * u * s));
  let y = pad;

  // Picture, if asked for and there is room for it to be legible.
  let pic = 0;
  if (opts.image && width / u >= 40) {
    pic = Math.round(Math.min(20 * u * s, inner * 0.3));
  }
  const nameWidth = pic ? inner - pic - Math.round(2 * u * s) : inner;

  // Name
  const nameSize = 7 * u * s;
  setFont(ctx, 800, nameSize);
  const names = wrap(ctx, food.name, nameWidth, 2);
  for (const text of names) {
    if (draw) ctx.fillText(text, pad, y);
    y += nameSize * 1.1;
  }
  if (pic) {
    if (draw) opts.picRect = { x: width - pad - pic, y: pad, size: pic };
    y = Math.max(y, pad + pic);
  }

  // Rule
  y += 1.1 * u * s;
  if (draw) ctx.fillRect(pad, Math.round(y), inner, line);
  y += line + 1.5 * u * s;

  // Best before
  const tagSize = 2.7 * u * s;
  const dateSize = 5.4 * u * s;
  const date = labelDate(food.expires_on);
  setFont(ctx, 700, tagSize);
  const tagWidth = ctx.measureText("BEST BEFORE").width;
  setFont(ctx, 800, dateSize);
  const dateWidth = ctx.measureText(date).width;
  const gap = 1.8 * u * s;

  if (tagWidth + gap + dateWidth <= inner) {
    if (draw) {
      setFont(ctx, 700, tagSize);
      ctx.fillText("BEST BEFORE", pad, y + (dateSize - tagSize) * 0.78);
      setFont(ctx, 800, dateSize);
      ctx.fillText(date, pad + tagWidth + gap, y);
    }
    y += dateSize * 1.12;
  } else {
    if (draw) {
      setFont(ctx, 700, tagSize);
      ctx.fillText("BEST BEFORE", pad, y);
    }
    y += tagSize * 1.25;
    if (draw) {
      setFont(ctx, 800, dateSize);
      ctx.fillText(date, pad, y);
    }
    y += dateSize * 1.12;
  }

  // Description
  if (food.description) {
    const size = 3.3 * u * s;
    setFont(ctx, 500, size);
    y += 0.6 * u * s;
    for (const text of wrap(ctx, food.description, inner, 2)) {
      if (draw) ctx.fillText(text, pad, y);
      y += size * 1.2;
    }
  }

  // Allergens: a box with an inverted header, which prints crisp and is the
  // first thing the eye lands on.
  y += 1.6 * u * s;
  const allergens = (food.allergens || []).map((a) => a.toUpperCase());
  const headSize = 2.8 * u * s;
  const boxPad = Math.round(1.2 * u * s);
  const border = line;

  if (allergens.length) {
    const listSize = 3.9 * u * s;
    const headHeight = Math.round(headSize * 1.6);
    setFont(ctx, 800, listSize);
    const lines = wrap(ctx, allergens.join(", "), inner - boxPad * 2, 3);
    const boxHeight = headHeight + boxPad + lines.length * listSize * 1.18 + boxPad;

    if (draw) {
      const top = Math.round(y);
      ctx.fillRect(pad, top, inner, headHeight);
      ctx.fillRect(pad, top, border, boxHeight);
      ctx.fillRect(pad + inner - border, top, border, boxHeight);
      ctx.fillRect(pad, top + boxHeight - border, inner, border);

      ctx.fillStyle = "#fff";
      setFont(ctx, 800, headSize);
      ctx.fillText("CONTAINS", pad + boxPad, top + (headHeight - headSize) / 2);
      ctx.fillStyle = "#000";

      setFont(ctx, 800, listSize);
      let ly = top + headHeight + boxPad;
      for (const text of lines) {
        ctx.fillText(text, pad + boxPad, ly);
        ly += listSize * 1.18;
      }
    }
    y += boxHeight;
  } else {
    const boxHeight = headSize * 1.2 + boxPad * 2;
    if (draw) {
      const top = Math.round(y);
      ctx.fillRect(pad, top, inner, border);
      ctx.fillRect(pad, top + boxHeight - border, inner, border);
      ctx.fillRect(pad, top, border, boxHeight);
      ctx.fillRect(pad + inner - border, top, border, boxHeight);
      setFont(ctx, 700, headSize);
      ctx.fillText("NO ALLERGENS DECLARED", pad + boxPad, top + boxPad);
    }
    y += boxHeight;
  }

  return Math.ceil(y + pad);
}

// A single or few-line strip, for narrow tape where the label runs lengthwise.
// Returns the length used. `across` is the tape's printable height in dots.
function stripLayout(ctx, food, across, scale, opts, draw, layout = "auto") {
  const u = opts.dpmm;
  const padX = Math.round(2 * u);
  const padY = Math.max(1, Math.round(across * 0.06));
  const avail = across - padY * 2;
  const date = labelDate(food.expires_on);
  const allergens = (food.allergens || []).map((a) => a.toUpperCase()).join(", ");

  let rows;
  if (layout === "three" && allergens) {
    rows = [
      [800, 0.42, food.name],
      [700, 0.26, `BEST BEFORE ${date}`],
      [800, 0.26, `CONTAINS ${allergens}`],
    ];
  } else if (avail / u < 6.5) {
    // Very narrow tape: one line carries everything.
    rows = [[800, 0.92, `${food.name}  ·  BB ${date}${allergens ? `  ·  ${allergens}` : ""}`]];
  } else if (avail / u < 13 || !allergens) {
    rows = [
      [800, 0.55, food.name],
      [700, 0.36, `BB ${date}${allergens ? `  ·  CONTAINS ${allergens}` : ""}`],
    ];
  } else {
    rows = [
      [800, 0.42, food.name],
      [700, 0.26, `BEST BEFORE ${date}`],
      [800, 0.26, `CONTAINS ${allergens}`],
    ];
  }

  const total = rows.reduce((sum, [, share]) => sum + share, 0);
  const fill = 0.9 / total;  // leave a little leading between rows
  let y = padY;
  let longest = 0;

  for (const [weight, share] of rows) {
    const size = avail * share * fill * scale;
    setFont(ctx, weight, size);
    const text = rows.find((row) => row[1] === share && row[0] === weight)[2];
    longest = Math.max(longest, ctx.measureText(text).width);
    if (draw) ctx.fillText(text, padX, y);
    y += size + (avail * 0.1) / rows.length;
  }

  return Math.ceil(longest + padX * 2);
}

/* ---------- Geometry ---------- */

// Works out the drawing area as read (width × height in dots) and whether it
// must be turned to run along the tape.
export function geometryFor(model, label) {
  const u = dpmm(model);

  if (model.family === "pt") {
    return { u, across: label.pins, along: null, rotated: true, strip: true };
  }

  const [across, along] = label.printable;
  if (label.kind === "endless") {
    // Narrow rolls read better with the text running along the tape.
    if (across < 400) return { u, across, along: null, rotated: true, strip: across / u < 20 };
    return { u, across, along: null, rotated: false };
  }
  // Die-cut: turn tall, narrow labels so text runs along the long side.
  if (across < 400 && along > across) {
    return { u, across, along, rotated: true, strip: across / u < 20 };
  }
  return { u, across, along, rotated: false };
}

/* ---------- Rendering ---------- */

function threshold(ctx, width, height) {
  const { data } = ctx.getImageData(0, 0, width, height);
  const bits = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < bits.length; i += 1, p += 4) {
    const lum = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
    bits[i] = lum < INK_THRESHOLD ? 1 : 0;
  }
  return bits;
}

// Floyd–Steinberg, so a photo keeps its tones on a black-only printer.
function ditherInto(bits, width, image, rect) {
  const { x: rx, y: ry, size } = rect;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);
  const crop = Math.min(image.width, image.height);
  ctx.drawImage(image, (image.width - crop) / 2, (image.height - crop) / 2, crop, crop,
    0, 0, size, size);

  const { data } = ctx.getImageData(0, 0, size, size);
  const lum = new Float32Array(size * size);
  for (let i = 0, p = 0; i < lum.length; i += 1, p += 4) {
    lum[i] = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const ink = lum[i] < 128;
      const error = lum[i] - (ink ? 0 : 255);
      if (x + 1 < size) lum[i + 1] += error * 7 / 16;
      if (y + 1 < size) {
        if (x > 0) lum[i + size - 1] += error * 3 / 16;
        lum[i + size] += error * 5 / 16;
        if (x + 1 < size) lum[i + size + 1] += error / 16;
      }
      const tx = rx + x;
      const ty = ry + y;
      bits[ty * width + tx] = ink ? 1 : 0;
    }
  }
}

function drawToBitmap(width, height, paint, image) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";
  const opts = paint(ctx);
  const data = threshold(ctx, width, height);
  if (image && opts?.picRect) {
    try {
      ditherInto(data, width, image, opts.picRect);
    } catch {
      // A cross-origin picture taints its canvas; the label prints without it.
    }
  }
  return { width, height, data };
}

// Turns an as-read bitmap 90° anticlockwise into the printer's orientation,
// the same rotation brother_ql applies to tall images.
function rotate(bitmap) {
  const { width: w, height: h, data } = bitmap;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (data[y * w + x]) out[(w - 1 - x) * h + y] = 1;
    }
  }
  return { width: h, height: w, data: out };
}

export async function renderLabel(food, { model, label, picture = false }) {
  const geo = geometryFor(model, label);
  const image = picture ? await loadImage(food.image_url) : null;
  const measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.textBaseline = "top";
  const opts = { dpmm: geo.u, image };

  let width;
  let height;
  let paint;

  if (geo.strip) {
    // Narrow tape: height is fixed by the tape, length follows the text.
    height = geo.across;
    const natural = stripLayout(measureCtx, food, height, 1, opts, false);
    let scale = 1;
    let layout = "auto";
    if (geo.along) {
      // A fixed length: try two and three rows and keep whichever leaves the
      // name biggest, so short labels use their height instead of shrinking.
      width = geo.along;
      const fit = (mode) => Math.min(1, fitScale(
        (s) => stripLayout(measureCtx, food, height, s, opts, false, mode), width, 0.3, 1));
      const two = fit("auto");
      const three = fit("three");
      const autoShare = (height / geo.u) * 0.88 < 6.5 ? 0.92 : 0.55;
      if (three * 0.42 > two * autoShare) {
        layout = "three";
        scale = three;
      } else {
        scale = two;
      }
    } else {
      width = Math.max(natural, model.family === "pt" ? Math.round(20 * geo.u) : 150);
    }
    paint = (ctx) => { stripLayout(ctx, food, height, scale, opts, true, layout); return opts; };
  } else if (geo.rotated) {
    // A wider roll or die-cut turned on its side: fixed height, set length.
    height = geo.across;
    width = geo.along || Math.round(Math.min(90, Math.max(50, (height / geo.u) * 2.3)) * geo.u);
    const scale = fitScale((s) => blockLayout(measureCtx, food, width, s, opts, false), height);
    const used = blockLayout(measureCtx, food, width, scale, opts, false);
    const offset = Math.max(0, Math.floor((height - used) / 2));
    paint = (ctx) => {
      ctx.translate(0, offset);
      blockLayout(ctx, food, width, scale, opts, true);
      if (opts.picRect) opts.picRect = { ...opts.picRect, y: opts.picRect.y + offset };
      return opts;
    };
  } else if (geo.along) {
    // Upright die-cut: fill the label, centred vertically.
    width = geo.across;
    height = geo.along;
    const scale = fitScale((s) => blockLayout(measureCtx, food, width, s, opts, false), height);
    const used = blockLayout(measureCtx, food, width, scale, opts, false);
    const offset = Math.max(0, Math.floor((height - used) / 2));
    paint = (ctx) => {
      ctx.translate(0, offset);
      blockLayout(ctx, food, width, scale, opts, true);
      if (opts.picRect) opts.picRect = { ...opts.picRect, y: opts.picRect.y + offset };
      return opts;
    };
  } else {
    // Upright continuous roll: full width, length follows the content.
    width = geo.across;
    height = Math.max(150, blockLayout(measureCtx, food, width, 1, opts, false));
    paint = (ctx) => { blockLayout(ctx, food, width, 1, opts, true); return opts; };
  }

  const view = drawToBitmap(width, height, paint, image);

  // The printer wants QL rows across the head and P-touch columns along the
  // tape; ptRows handles the latter itself, so only rotated QL turns here.
  const print = model.family === "ql" && geo.rotated ? rotate(view) : view;

  return {
    view,
    print,
    rotated: geo.rotated,
    widthMm: width / geo.u,
    heightMm: height / geo.u,
    dpmm: geo.u,
  };
}

// Black-and-white canvas of a bitmap, for previews and image export.
export function bitmapCanvas(bitmap) {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  const pixels = ctx.createImageData(bitmap.width, bitmap.height);
  for (let i = 0, p = 0; i < bitmap.data.length; i += 1, p += 4) {
    const value = bitmap.data[i] ? 0 : 255;
    pixels.data[p] = value;
    pixels.data[p + 1] = value;
    pixels.data[p + 2] = value;
    pixels.data[p + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}
