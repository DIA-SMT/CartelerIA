import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const sourcePath = path.join(process.cwd(), "reports", "territorial-link-candidates.csv");
const outputDirectory = path.join(process.cwd(), "reports");
const outputPath = path.join(outputDirectory, "territorial-link-proposals.json");
const raw = await readFile(sourcePath, "utf8");
const rows = parseCsv(raw);
const approvedValues = new Set(["si", "sí", "yes", "true", "1"]);
const reviewed = rows.filter((row) =>
  approvedValues.has(
    String(row.reviewed ?? row.approved ?? "").trim().toLocaleLowerCase("es"),
  ),
);

if (!reviewed.length) throw new Error("No hay filas marcadas como revisadas en el reporte.");
assertUnique(reviewed.map((row) => row.record_id), "record_id");
assertUnique(reviewed.map((row) => row.candidate_feature_id), "candidate_feature_id");

const artifact = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: path.basename(sourcePath),
  status: "requires_administrator_approval",
  notice:
    "Este archivo contiene propuestas revisadas. No aprueba ni modifica vínculos; cada vínculo debe tramitarse y resolverse en CartelerIA con fundamento.",
  proposals: reviewed.map((row) => ({
    cartelId: row.record_id,
    territorialFeatureId: row.candidate_feature_id,
    reviewNotes: row.review_notes || null,
    evidence: {
      candidateName: row.candidate_name || null,
      distanceM: numberOrNull(row.distance_m),
      addressSimilarity: numberOrNull(row.address_similarity),
      confidence: row.confidence || null,
    },
  })),
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ proposals: reviewed.length, outputPath }, null, 2));

function parseCsv(value) {
  const lines = value.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const normalized = lines.map(normalizeExcelWrappedLine);
  const headers = parseCsvLine(normalized[0]);
  return normalized.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function normalizeExcelWrappedLine(line) {
  if (line.startsWith('"') && line.endsWith('"') && line.includes('""')) {
    return line.slice(1, -1).replaceAll('""', '"');
  }
  return line;
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell);
  return cells;
}

function assertUnique(values, label) {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  if (duplicates.length) throw new Error(`${label} duplicado: ${[...new Set(duplicates)].join(", ")}`);
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
