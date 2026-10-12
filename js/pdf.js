// Minimal one-page PDF writers. The page is sized to the label itself, so an
// app that receives it (iPrint&Label, P-touch Design&Print, AirPrint) prints
// it 1:1 instead of shrinking an A4 sheet onto a narrow roll.

function bytes(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

const PT_PER_MM = 72 / 25.4;

function assemble(objects) {
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (chunk) => { chunks.push(chunk); length += chunk.length; };

  push(bytes("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"));
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
  for (const offset of offsets) table += `${String(offset).padStart(10, "0")} 00000 n \n`;
  table += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  push(bytes(table));
  return new Blob(chunks, { type: "application/pdf" });
}

function page(widthPt, heightPt, image) {
  const w = widthPt.toFixed(2);
  const h = heightPt.toFixed(2);
  const draw = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  return [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${w} ${h}]` +
      "/Resources<</XObject<</Im0 4 0 R>>>>/Contents 5 0 R>>",
    image,
    { dict: `<</Length ${draw.length}>>`, stream: bytes(draw) },
  ];
}

// A label bitmap as a 1-bit image: every printer dot stays a sharp dot.
export function bitmapToPdf(bitmap, widthMm, heightMm) {
  const rowBytes = Math.ceil(bitmap.width / 8);
  const data = new Uint8Array(rowBytes * bitmap.height);
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      if (bitmap.data[y * bitmap.width + x]) data[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  // /Decode [1 0] makes a set bit print black.
  const image = {
    dict: `<</Type/XObject/Subtype/Image/Width ${bitmap.width}/Height ${bitmap.height}` +
      `/ColorSpace/DeviceGray/BitsPerComponent 1/Decode[1 0]/Interpolate false/Length ${data.length}>>`,
    stream: data,
  };
  return assemble(page(widthMm * PT_PER_MM, heightMm * PT_PER_MM, image));
}

// Kept for callers that already have a JPEG.
export function jpegToPdf(jpeg, width, height, widthMm = 101.6, heightMm = (101.6 * height) / width) {
  const image = {
    dict: `<</Type/XObject/Subtype/Image/Width ${width}/Height ${height}` +
      `/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${jpeg.length}>>`,
    stream: jpeg,
  };
  return assemble(page(widthMm * PT_PER_MM, heightMm * PT_PER_MM, image));
}
