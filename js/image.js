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

// Picture search runs against two free, key-less, CORS-friendly sources:
// Open Food Facts for branded products, Wikimedia Commons for everything else.
async function searchOpenFoodFacts(query, signal) {
  const url = "https://world.openfoodfacts.org/cgi/search.pl?" + new URLSearchParams({
    search_terms: query,
    search_simple: "1",
    action: "process",
    json: "1",
    page_size: "12",
    fields: "product_name,brands,image_front_url,image_front_small_url",
  });

  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Open Food Facts returned ${response.status}`);

  const body = await response.json();
  return (body.products || [])
    .filter((product) => product.image_front_url)
    .map((product) => ({
      thumb: product.image_front_small_url || product.image_front_url,
      full: product.image_front_url,
      title: [product.brands, product.product_name].filter(Boolean).join(" — "),
    }));
}

async function searchCommons(query, signal) {
  const url = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrsearch: `${query} food`,
    gsrnamespace: "6",
    gsrlimit: "12",
    prop: "imageinfo",
    iiprop: "url",
    iiurlwidth: "320",
  });

  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Wikimedia returned ${response.status}`);

  const body = await response.json();
  return Object.values(body.query?.pages || {})
    .map((page) => ({
      thumb: page.imageinfo?.[0]?.thumburl,
      full: page.imageinfo?.[0]?.url,
      title: (page.title || "").replace(/^File:|\.[a-z]+$/gi, ""),
    }))
    .filter((result) => result.thumb);
}

// One slow or broken source should never sink the whole search.
export async function searchImages(query, signal) {
  const results = await Promise.allSettled([
    searchOpenFoodFacts(query, signal),
    searchCommons(query, signal),
  ]);

  const found = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []);

  if (!found.length && results.every((result) => result.status === "rejected")) {
    throw new Error(results[0].reason?.message || "Search failed");
  }
  return found;
}
