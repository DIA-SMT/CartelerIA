import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const sourcePath = path.join(process.cwd(), "reports", "territorial-link-candidates.csv");
const outputDirectory = path.join(process.cwd(), "supabase", "generated");
const outputPath = path.join(outputDirectory, "apply_approved_territorial_links.sql");
const raw = await readFile(sourcePath, "utf8");
const rows = parseCsv(raw);
const approvedValues = new Set(["si", "sí", "yes", "true", "1"]);
const approved = rows.filter((row) => approvedValues.has(String(row.approved ?? "").trim().toLocaleLowerCase("es")));

if (!approved.length) throw new Error("No hay filas aprobadas en el reporte.");
assertUnique(approved.map((row) => row.record_id), "record_id");
assertUnique(approved.map((row) => row.candidate_feature_id), "candidate_feature_id");

const values = approved
  .map((row) => `  (${sqlLiteral(row.record_id)}, ${sqlLiteral(row.candidate_feature_id)})`)
  .join(",\n");
const sql = `-- Generado desde territorial-link-candidates.csv.
-- Cantidad de vínculos aprobados: ${approved.length}
-- Es una única sentencia atómica y no utiliza tablas temporales.
with approved_links (cartel_id, territorial_feature_id) as (
  values
${values}
), updated as (
  update public.carteles as cartel
  set territorial_feature_id = approved.territorial_feature_id,
      updated_at = now()
  from approved_links as approved
  where cartel.id = approved.cartel_id
    and (cartel.territorial_feature_id is null or cartel.territorial_feature_id = approved.territorial_feature_id)
  returning cartel.id, cartel.territorial_feature_id, cartel.empresa, cartel.domicilio
)
select id, territorial_feature_id, empresa, domicilio
from updated
order by id;
`;

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, sql, "utf8");
console.log(JSON.stringify({ approved: approved.length, outputPath }, null, 2));

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

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
