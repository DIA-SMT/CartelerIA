// ============================================================================
// Validación: "los conteos coinciden con el filtrado real" (Fase 4a)
// ----------------------------------------------------------------------------
// Gate del pipeline ANTES de conectar el LLM. Para una batería de intents,
// asevera que:
//    runQuery(intent).count === filterTerritorialCarteles(intentToFilterState).length
// usando los MISMOS módulos que la app (sin reimplementar lógica).
//
// Correr con:  npx tsx scripts/validate-query-counts.ts
// ============================================================================

import { filterTerritorialCarteles, loadTerritorialLayers, type AnalyzedCartel } from "@/data/territorial";
import { parseQueryIntent, type QueryIntent } from "@/data/map-query";
import { evaluateCartel, intentToFilterState, isStructured, runQuery } from "@/lib/map-query-engine";
import { interpretQuestion } from "@/lib/map-query-interpreter";
import { runInspectionQuery } from "@/lib/inspection-query-engine";
import type { InspectionRecord } from "@/lib/inspection-repository";

async function main() {
const { analyzed } = await loadTerritorialLayers();
const carteles = analyzed.features as AnalyzedCartel[];

let failures = 0;
const line = (ok: boolean, msg: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${msg}`);
};

console.log(`\nCarteles cargados: ${carteles.length}\n`);

// ---- Intents de prueba (estructurados y de fallback por IDs) ----------------
const cases: { name: string; intent: QueryIntent }[] = [
  { name: "visualStatus=fuera_zona (estructurado→main)", intent: { operation: "count", predicate: { field: "visualStatus", op: "eq", value: "fuera_zona" }, applyToMap: false, unsupported: [], explanation: "" } },
  { name: "enablement=no_habilitable (estructurado)", intent: { operation: "list", predicate: { field: "enablementStatus", op: "eq", value: "no_habilitable" }, applyToMap: true, unsupported: [], explanation: "" } },
  { name: "support=led (estructurado)", intent: { operation: "count", predicate: { field: "supportType", op: "eq", value: "led" }, applyToMap: false, unsupported: [], explanation: "" } },
  { name: "AND visualStatus=deuda + support=gigantografia (estructurado)", intent: { operation: "list", predicate: { op: "and", clauses: [{ field: "visualStatus", op: "eq", value: "deuda" }, { field: "supportType", op: "eq", value: "gigantografia" }] }, applyToMap: true, unsupported: [], explanation: "" } },
  { name: "AND prioridad alta/crítica + zona sensible (fallback→ids)", intent: { operation: "list", predicate: { op: "and", clauses: [{ field: "controlPriority", op: "in", value: ["alta", "critica"] }, { field: "sensitiveZone", op: "is", value: true }] }, applyToMap: true, unsupported: [], explanation: "" } },
  { name: "analysisStatus=fuera_zona_permitida (fallback→ids)", intent: { operation: "count", predicate: { field: "analysisStatus", op: "eq", value: "fuera_zona_permitida" }, applyToMap: false, unsupported: [], explanation: "" } },
  { name: "distancia al corredor > 100 (fallback→ids)", intent: { operation: "count", predicate: { field: "distanceToCorridorM", op: "gt", value: 100 }, applyToMap: false, unsupported: [], explanation: "" } },
  { name: "sin predicado (todos)", intent: { operation: "count", applyToMap: false, unsupported: [], explanation: "" } },
];

console.log("== Conteo del executor == conteo del mapa ==");
for (const { name, intent } of cases) {
  const exec = runQuery(intent, carteles);
  const mapped = filterTerritorialCarteles(carteles, intentToFilterState(intent, carteles));
  const kind = isStructured(intent) ? "estructurado" : "ids";
  line(exec.count === mapped.length, `[${kind}] ${name}: executor=${exec.count} mapa=${mapped.length}`);
}

// ---- Coherencia del evaluador con intentToFilterState (ids) ------------------
console.log("\n== Set de IDs coincide (fallback) ==");
for (const { name, intent } of cases) {
  if (isStructured(intent)) continue;
  const exec = runQuery(intent, carteles);
  const state = intentToFilterState(intent, carteles);
  const mappedIds = new Set(filterTerritorialCarteles(carteles, state).map((c) => String(c.properties.id)));
  const same = exec.ids.length === mappedIds.size && exec.ids.every((id) => mappedIds.has(id));
  line(same, `${name}: |ids|=${exec.ids.length}`);
}

// ---- Los 4 ejemplos objetivo del prompt -------------------------------------
console.log("\n== Ejemplos objetivo (intérprete por reglas) ==");
const examples = [
  "Mostrame carteles alquilados sin habilitación",
  "¿Cuántos están fuera de zona?",
  "¿Qué empresa tiene más observaciones?",
  "Mostrame carteles riesgosos cerca de zonas sensibles",
];
for (const question of examples) {
  const intent = interpretQuestion(question);
  const result = runQuery(intent, carteles);
  const summary = intent.operation === "aggregate"
    ? `top=${result.groups[0]?.label ?? "—"} (${result.groups[0]?.count ?? 0})`
    : `count=${result.count}`;
  // Validación de coherencia también para el ejemplo
  const mapped = filterTerritorialCarteles(carteles, intentToFilterState(intent, carteles));
  line(result.count === mapped.length, `"${question}" → ${intent.operation}, ${summary}${intent.unsupported.length ? `, sin dato: ${intent.unsupported.join(",")}` : ""}`);
}

// ---- Dataset inspecciones (Fase 4b) — datos sintéticos --------------------
console.log("\n== Inspecciones (agregación sobre datos sintéticos) ==");
const mkInsp = (id: string, empresa: string | null, estado: InspectionRecord["estado"]): InspectionRecord => ({
  id, cartelId: "c1", estado, tipoSoporte: null, anchoM: null, altoM: null, superficieM2: null,
  empresa, cuit: null, observaciones: null, programadaPara: null, inspeccionadaEn: null, createdAt: "2026-07-08",
});
const inspecciones: InspectionRecord[] = [
  mkInsp("1", "Alfa Publicidad", "con_observaciones"),
  mkInsp("2", "Alfa Publicidad", "con_observaciones"),
  mkInsp("3", "Alfa Publicidad", "regular"),
  mkInsp("4", "Beta SA", "con_observaciones"),
  mkInsp("5", null, "con_observaciones"),
];

const aggIntent = interpretQuestion("¿Qué empresa tiene más observaciones?");
line(aggIntent.dataset === "inspecciones" && aggIntent.operation === "aggregate", `intent inspecciones aggregate (dataset=${aggIntent.dataset})`);
const aggResult = runInspectionQuery(aggIntent, inspecciones);
line(aggResult.groups[0]?.label === "Alfa Publicidad" && aggResult.groups[0]?.count === 2, `top empresa = Alfa Publicidad (2) [obtenido: ${aggResult.groups[0]?.label} ${aggResult.groups[0]?.count}]`);
line(aggResult.groups.every((g) => g.label !== "(sin dato)"), "empresa sin dato excluida del ranking");

const countIntent = interpretQuestion("¿cuántas inspecciones con observaciones hay?");
const countResult = runInspectionQuery(countIntent, inspecciones);
line(countIntent.dataset === "inspecciones" && countResult.count === 4, `conteo con observaciones = 4 [obtenido: ${countResult.count}]`);

// parseQueryIntent debe RECHAZAR un predicado que mezcla datasets
const crossDataset = parseQueryIntent({ operation: "count", dataset: "inspecciones", predicate: { field: "visualStatus", op: "eq", value: "fuera_zona" }, applyToMap: false, unsupported: [], explanation: "" });
line(crossDataset === null, "rechaza predicado con campo de otro dataset");

// Sanity extra: el evaluador nunca debe seleccionar más que el total
const all = runQuery({ operation: "count", applyToMap: false, unsupported: [], explanation: "" }, carteles);
line(all.count === carteles.length, `sin predicado selecciona todos (${all.count})`);

console.log(`\n${failures === 0 ? "✅ TODO OK" : `❌ ${failures} fallo(s)`}\n`);
if (failures > 0) process.exit(1);
}

main();
