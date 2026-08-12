// Uploaded pictures are stored inline as data URLs, so they are shrunk first
// to keep rows small enough for a normal Supabase text column.
const MAX_EDGE = 640;
const QUALITY = 0.75;

export function shrinkToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file is not an image"));
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", QUALITY));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function imageSearchUrl(query) {
  const term = encodeURIComponent(`${query} food`.trim());
  return `https://duckduckgo.com/?q=${term}&iax=images&ia=images`;
}
