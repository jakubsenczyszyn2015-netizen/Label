// A minimal PDF writer: one page holding one JPEG. Enough for a label, and it
// produces a real .pdf file rather than relying on the browser's print dialog.

function bytes(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

// 72pt to the inch; a label around 100mm wide prints well from most apps.
const PAGE_WIDTH = 288;

export function jpegToPdf(jpeg, width, height) {
  const pageHeight = Math.round((PAGE_WIDTH * height) / width);
  const draw = `q ${PAGE_WIDTH} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q`;

  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${PAGE_WIDTH} ${pageHeight}]` +
      "/Resources<</XObject<</Im0 4 0 R>>>>/Contents 5 0 R>>",
    { dict: `<</Type/XObject/Subtype/Image/Width ${width}/Height ${height}` +
        `/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${jpeg.length}>>`,
      stream: jpeg },
    { dict: `<</Length ${draw.length}>>`, stream: bytes(draw) },
  ];

  const chunks = [];
  const offsets = [];
  let length = 0;

  const push = (chunk) => {
    chunks.push(chunk);
    length += chunk.length;
  };

  push(bytes("%PDF-1.4\n"));

  objects.forEach((object, index) => {
    offsets[index] = length;
    const id = index + 1;
    if (typeof object === "string") {
      push(bytes(`${id} 0 obj\n${object}\nendobj\n`));
      return;
    }
    push(bytes(`${id} 0 obj\n${object.dict}\nstream\n`));
    push(object.stream);
    push(bytes("\nendstream\nendobj\n"));
  });

  const xref = length;
  let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    table += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  table += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  push(bytes(table));

  return new Blob(chunks, { type: "application/pdf" });
}
