// Everything that leaves the app — preview, PNG, PDF, the share to the
// Brother app, the system print dialog, and direct printing — comes from the
// same thermal render, sized to the label chosen in the print settings.

import { renderLabel, bitmapCanvas } from "./thermal.js";
import { bitmapToPdf } from "./pdf.js";
import { printSettings } from "./settings.js";

export function labelName(food, extension) {
  const stem = food.name.replace(/[^\w -]/g, "").trim();
  return `${stem || "label"}.${extension}`;
}

export async function renderFor(food, settings = printSettings()) {
  return renderLabel(food, {
    model: settings.modelSpec,
    label: settings.labelSpec,
    picture: settings.picture,
  });
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// Every format at once, ready before the user taps — navigator.share() has
// to run inside the tap, and iOS drops the app targets if it waits first.
export async function prepareLabel(food, settings = printSettings()) {
  const render = await renderFor(food, settings);
  const canvas = bitmapCanvas(render.view);
  const [png, jpeg] = await Promise.all([
    canvasBlob(canvas, "image/png"),
    canvasBlob(canvas, "image/jpeg", 0.95),
  ]);
  const pdf = bitmapToPdf(render.view, render.widthMm, render.heightMm);
  return {
    render,
    dataUrl: canvas.toDataURL("image/png"),
    png: new File([png], labelName(food, "png"), { type: "image/png" }),
    jpeg: new File([jpeg], labelName(food, "jpg"), { type: "image/jpeg" }),
    pdf: new File([pdf], labelName(food, "pdf"), { type: "application/pdf" }),
  };
}

// Resolves to shared | cancelled | unsupported | refused. Never falls back to
// <a download>, which is inert inside an installed iOS app.
export function shareFile(file) {
  if (!navigator.canShare?.({ files: [file] })) return Promise.resolve("unsupported");
  return navigator.share({ files: [file] })
    .then(() => "shared")
    .catch((error) => {
      if (error.name === "AbortError") return "cancelled";
      console.warn("Share refused:", error.name, error.message);
      return "refused";
    });
}

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
  const files = await prepareLabel(food);
  return saveFile(files[kind]);
}

// The system print dialog, with the page sized exactly to the label. That is
// what makes "Print → Share → iPrint&Label" come out 1:1, and what an
// AirPrint label printer needs. It prints from the main document, so
// cancelling the dialog simply returns to the app.
export async function systemPrint(food) {
  const files = await prepareLabel(food);
  const { widthMm, heightMm } = files.render;
  const w = `${widthMm.toFixed(2)}mm`;
  const h = `${heightMm.toFixed(2)}mm`;

  document.getElementById("print-root")?.remove();
  document.getElementById("print-page")?.remove();

  const root = document.createElement("div");
  root.id = "print-root";
  const img = new Image();
  img.alt = food.name;
  img.style.cssText = `width:${w};height:${h};display:block;image-rendering:pixelated`;
  root.append(img);

  const style = document.createElement("style");
  style.id = "print-page";
  style.textContent = `
    #print-root { display: none; }
    @page { size: ${w} ${h}; margin: 0; }
    @media print {
      html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
      body > *:not(#print-root) { display: none !important; }
      #print-root { display: block !important; }
    }`;

  document.head.append(style);
  document.body.append(root);

  await new Promise((resolve) => {
    img.onload = resolve;
    img.onerror = resolve;
    img.src = files.dataUrl;
  });

  const cleanup = () => {
    root.remove();
    style.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  // Some browsers never fire afterprint; tidy up regardless.
  setTimeout(cleanup, 60000);
  return "printing";
}
