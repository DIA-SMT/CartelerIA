import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

nextEnv.loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.");

const supabase = createClient(url, anonKey, { auth: { persistSession: false } });
const { data: records, error } = await supabase
  .from("carteles")
  .select("id,empresa,domicilio,numero,latitud,longitud,territorial_feature_id")
  .order("id");
if (error) throw new Error(`Supabase: ${error.message}`);

const geojsonPath = path.join(process.cwd(), "public", "data", "carteles_analizados_buffer75.json");
const geojson = JSON.parse(await readFile(geojsonPath, "utf8"));
const features = geojson.features.filter((feature) => feature.geometry?.type === "Point");
const candidates = [];

for (const record of records ?? []) {
  if (!Number.isFinite(record.latitud) || !Number.isFinite(record.longitud)) continue;
  const address = [record.domicilio, record.numero].filter(Boolean).join(" ");
  const ranked = features
    .map((feature) => {
      const [longitude, latitude] = feature.geometry.coordinates;
      const distanceM = haversineMeters(record.latitud, record.longitud, latitude, longitude);
      const addressSimilarity = tokenSimilarity(address, String(feature.properties?.name ?? ""));
      const distanceScore = Math.max(0, 1 - distanceM / 120);
      return { feature, distanceM, addressSimilarity, score: distanceScore * 0.72 + addressSimilarity * 0.28 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const best = ranked[0];
  const second = ranked[1];
  const distanceGapM = second ? second.distanceM - best.distanceM : 9999;
  candidates.push({ record, address, best, second, distanceGapM, confidence: "revisar", conflicts: 0 });
}

const candidateFrequency = new Map();
for (const candidate of candidates) {
  const featureId = String(candidate.best.feature.properties?.id);
  candidateFrequency.set(featureId, (candidateFrequency.get(featureId) ?? 0) + 1);
}
for (const candidate of candidates) {
  candidate.conflicts = candidateFrequency.get(String(candidate.best.feature.properties?.id)) ?? 0;
  candidate.confidence = getConfidence(candidate.best, candidate.distanceGapM, candidate.conflicts);
}

const summary = {
  records: records?.length ?? 0,
  locatedRecords: candidates.length,
  territorialFeatures: features.length,
  alreadyLinked: records?.filter((record) => record.territorial_feature_id).length ?? 0,
  highConfidence: candidates.filter((candidate) => candidate.confidence === "alta").length,
  mediumConfidence: candidates.filter((candidate) => candidate.confidence === "media").length,
  manualReview: candidates.filter((candidate) => candidate.confidence === "revisar").length,
};

console.log(JSON.stringify(summary, null, 2));

if (process.argv.includes("--write")) {
  const outputDirectory = path.join(process.cwd(), "reports");
  const outputPath = path.join(outputDirectory, "territorial-link-candidates.csv");
  await mkdir(outputDirectory, { recursive: true });
  const header = ["record_id", "empresa", "domicilio", "candidate_feature_id", "candidate_name", "distance_m", "address_similarity", "candidate_conflicts", "confidence", "second_candidate_id", "second_distance_m", "approved", "review_notes"];
  const rows = candidates.map(({ record, address, best, second, confidence, conflicts }) => [
    record.id,
    record.empresa,
    address,
    best.feature.properties?.id,
    best.feature.properties?.name,
    best.distanceM.toFixed(1),
    best.addressSimilarity.toFixed(2),
    conflicts,
    confidence,
    second?.feature.properties?.id ?? "",
    second?.distanceM.toFixed(1) ?? "",
    "",
    "",
  ]);
  await writeFile(outputPath, [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n"), "utf8");
  console.log(`Reporte generado: ${outputPath}`);
}

function getConfidence(best, distanceGapM, conflicts) {
  if (conflicts > 1) return "revisar";
  if (best.distanceM <= 12 && best.addressSimilarity >= 0.25 && distanceGapM >= 6) return "alta";
  if (best.distanceM <= 30 && best.addressSimilarity >= 0.35 && distanceGapM >= 8) return "alta";
  if (best.distanceM <= 70 && (best.addressSimilarity >= 0.2 || distanceGapM >= 15)) return "media";
  return "revisar";
}

function tokenSimilarity(left, right) {
  const leftTokens = new Set(normalize(left).split(" ").filter((token) => token.length > 2));
  const rightTokens = new Set(normalize(right).split(" ").filter((token) => token.length > 2));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function normalize(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/\b(avenida|av|calle|esquina|esq|provincia|de|del|la|las|los)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const radius = 6371000;
  const toRadians = Math.PI / 180;
  const deltaLat = (lat2 - lat1) * toRadians;
  const deltaLng = (lng2 - lng1) * toRadians;
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1 * toRadians) * Math.cos(lat2 * toRadians) * Math.sin(deltaLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(value));
}

function csvCell(value) {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
