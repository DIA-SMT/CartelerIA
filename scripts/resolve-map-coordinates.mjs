import fs from "node:fs/promises";

const fileUrl = new URL("../data/carteles.json", import.meta.url);
const carteles = JSON.parse(await fs.readFile(fileUrl, "utf8"));

function coordinatesFromUrl(url) {
  const place = url.match(/!3d(-?\d+(?:\.\d+))!4d(-?\d+(?:\.\d+))/);
  if (place) return { latitud: Number(place[1]), longitud: Number(place[2]) };
  const viewport = url.match(/@(-?\d+(?:\.\d+)),(-?\d+(?:\.\d+))/);
  if (viewport) return { latitud: Number(viewport[1]), longitud: Number(viewport[2]) };
  return null;
}

async function resolveCartel(cartel, index) {
  if (!cartel.googleMapsUrl || cartel.latitud != null) return cartel;
  try {
    const response = await fetch(cartel.googleMapsUrl, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 CarteleriaSMT/1.0" },
      signal: AbortSignal.timeout(20000)
    });
    const coordinates = coordinatesFromUrl(response.url);
    if (!coordinates) console.warn(`[${index + 1}] Sin coordenadas: ${cartel.id}`);
    else console.log(`[${index + 1}] ${cartel.id}: ${coordinates.latitud}, ${coordinates.longitud}`);
    return coordinates ? { ...cartel, ...coordinates } : cartel;
  } catch (error) {
    console.warn(`[${index + 1}] Error ${cartel.id}: ${error.message}`);
    return cartel;
  }
}

const resolved = new Array(carteles.length);
let cursor = 0;

async function worker() {
  while (cursor < carteles.length) {
    const index = cursor++;
    resolved[index] = await resolveCartel(carteles[index], index);
    await new Promise(resolve => setTimeout(resolve, 180));
  }
}

await Promise.all(Array.from({ length: 4 }, worker));
await fs.writeFile(fileUrl, `${JSON.stringify(resolved, null, 2)}\n`, "utf8");

const located = resolved.filter(item => item.latitud != null && item.longitud != null).length;
console.log(`Completado: ${located}/${resolved.length} carteles con coordenadas.`);
