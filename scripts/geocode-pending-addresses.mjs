import fs from "node:fs/promises";

const fileUrl = new URL("../data/carteles.json", import.meta.url);
const carteles = JSON.parse(await fs.readFile(fileUrl, "utf8"));
const cache = new Map();

function isValidCityPoint(latitude, longitude) {
  return latitude >= -26.95 && latitude <= -26.70 && longitude >= -65.35 && longitude <= -65.05;
}

function queryFor(cartel) {
  if (cartel.googleMapsUrl && !cartel.googleMapsUrl.startsWith("http")) return cartel.googleMapsUrl;
  return [cartel.domicilio, cartel.numero].filter(Boolean).join(" ");
}

async function geocode(address) {
  const key = address.toLocaleLowerCase("es-AR").replace(/\s+/g, " ").trim();
  if (cache.has(key)) return cache.get(key);
  const params = new URLSearchParams({ q: `${address}, San Miguel de Tucumán, Tucumán, Argentina`, format: "jsonv2", limit: "1", countrycodes: "ar" });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { "User-Agent": "CarteleriaSMT/1.0 municipal-document-viewer" }, signal: AbortSignal.timeout(20000) });
  const results = await response.json();
  const first = results[0];
  const coordinates = first ? { latitud: Number(first.lat), longitud: Number(first.lon) } : null;
  const accepted = coordinates && isValidCityPoint(coordinates.latitud, coordinates.longitud) ? coordinates : null;
  cache.set(key, accepted);
  await new Promise(resolve => setTimeout(resolve, 1100));
  return accepted;
}

let located = 0;
for (const cartel of carteles) {
  if (cartel.latitud != null && cartel.longitud != null) continue;
  const address = queryFor(cartel);
  if (!address) continue;
  try {
    const coordinates = await geocode(address);
    if (coordinates) {
      Object.assign(cartel, coordinates, { locationSource: "nominatim" });
      located += 1;
      console.log(`${cartel.id}: ${address} -> ${coordinates.latitud}, ${coordinates.longitud}`);
    } else console.warn(`${cartel.id}: sin coincidencia confiable para ${address}`);
  } catch (error) {
    console.warn(`${cartel.id}: ${error.message}`);
  }
}

for (const cartel of carteles) {
  if (cartel.latitud != null && cartel.longitud != null && !cartel.locationSource) cartel.locationSource = "google_maps";
}

await fs.writeFile(fileUrl, `${JSON.stringify(carteles, null, 2)}\n`, "utf8");
console.log(`Nuevos ubicados: ${located}. Pendientes: ${carteles.filter(item => item.latitud == null || item.longitud == null).length}.`);
