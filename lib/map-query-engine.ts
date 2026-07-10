// ============================================================================
// "Preguntale al mapa" — Motor de ejecución determinista (Fase 4a)
// ----------------------------------------------------------------------------
// Ejecuta un QueryIntent sobre los carteles REALES en memoria. Es la única
// pieza que cuenta/lista; la IA nunca lo hace. Garantiza que "conteo == lo que
// muestra el mapa" reusando el mismo evaluador para el resultado y para la
// traducción al filtro territorial (ver intentToFilterState + validación).
// ============================================================================

import {
  fieldValueLabel,
  QUERY_FIELDS,
  type Predicate,
  type QueryField,
  type QueryIntent,
  type QueryOperation,
} from "@/data/map-query";
import {
  getAdministrativeVisualStatus,
  initialTerritorialFilters,
  type AnalyzedCartel,
  type TerritorialFilterState,
} from "@/data/territorial";

export interface QueryGroup {
  key: string;
  label: string;
  count: number;
}

export interface QueryResultItem {
  id: string;
  name: string;
  empresa: string | null;
}

export interface QueryResult {
  operation: QueryOperation;
  count: number;
  ids: string[];
  items: QueryResultItem[];
  groups: QueryGroup[];
}

// ----------------------------------------------------------------------------
// Lectura de campos (única fuente: AnalyzedCartel.properties)
// ----------------------------------------------------------------------------
function getFieldValue(cartel: AnalyzedCartel, field: QueryField): string | number | boolean | null {
  const p = cartel.properties;
  switch (field) {
    case "analysisStatus": return p.analysisStatus;
    case "visualStatus": return getAdministrativeVisualStatus(cartel);
    case "taxStatus": return p.taxStatus;
    case "registryStatus": return p.registryStatus;
    case "enablementStatus": return p.enablementStatus;
    case "supportType": return p.supportType;
    case "controlPriority": return p.controlPriority;
    case "sensitiveZone": return Boolean(p.sensitiveZone);
    case "empresa": return p.administrative?.empresa ?? null;
    case "distanceToCorridorM": {
      const value = Number(p.distanceToCorridorM);
      return Number.isFinite(value) ? value : null;
    }
    case "distanceToAllowedPlaceM": {
      const value = Number(p.distanceToAllowedPlaceM);
      return Number.isFinite(value) ? value : null;
    }
    default:
      return null; // campos de otros datasets (inspecciones) no aplican a carteles
  }
}

// ----------------------------------------------------------------------------
// Evaluación de un predicado — genérica (reusable para cualquier dataset)
// ----------------------------------------------------------------------------
export type FieldGetter = (field: QueryField) => string | number | boolean | null;

export function evaluatePredicate(predicate: Predicate, getValue: FieldGetter): boolean {
  switch (predicate.op) {
    case "and": return predicate.clauses.every((clause) => evaluatePredicate(clause, getValue));
    case "or": return predicate.clauses.some((clause) => evaluatePredicate(clause, getValue));
    case "eq": { const v = getValue(predicate.field); return v != null && String(v) === predicate.value; }
    case "neq": { const v = getValue(predicate.field); return v == null || String(v) !== predicate.value; }
    case "in": { const v = getValue(predicate.field); return v != null && predicate.value.includes(String(v)); }
    case "contains": {
      const v = getValue(predicate.field);
      return typeof v === "string" && v.toLocaleLowerCase("es").includes(predicate.value.toLocaleLowerCase("es"));
    }
    case "is": { const v = getValue(predicate.field); return Boolean(v) === predicate.value; }
    case "lt": { const v = getValue(predicate.field); return typeof v === "number" && v < predicate.value; }
    case "lte": { const v = getValue(predicate.field); return typeof v === "number" && v <= predicate.value; }
    case "gt": { const v = getValue(predicate.field); return typeof v === "number" && v > predicate.value; }
    case "gte": { const v = getValue(predicate.field); return typeof v === "number" && v >= predicate.value; }
  }
}

export function evaluateCartel(cartel: AnalyzedCartel, predicate: Predicate): boolean {
  return evaluatePredicate(predicate, (field) => getFieldValue(cartel, field));
}

// ----------------------------------------------------------------------------
// Ejecución del intent → resultado exacto
// ----------------------------------------------------------------------------
export function runQuery(intent: QueryIntent, carteles: AnalyzedCartel[]): QueryResult {
  const selected = intent.predicate
    ? carteles.filter((cartel) => evaluateCartel(cartel, intent.predicate as Predicate))
    : carteles;

  const ids = selected.map((cartel) => String(cartel.properties.id));
  const items: QueryResultItem[] = selected.map((cartel) => ({
    id: String(cartel.properties.id),
    name: String(cartel.properties.name || "Cartel relevado"),
    empresa: cartel.properties.administrative?.empresa ?? null,
  }));

  let groups: QueryGroup[] = [];
  if (intent.operation === "aggregate" && intent.aggregate) {
    const { groupBy, top } = intent.aggregate;
    const skipEmpty = QUERY_FIELDS[groupBy].kind === "text"; // empresa sin dato no es un grupo real
    const counts = new Map<string, number>();
    for (const cartel of selected) {
      const raw = getFieldValue(cartel, groupBy);
      const isEmpty = raw == null || raw === "";
      if (isEmpty && skipEmpty) continue;
      const key = isEmpty ? "(sin dato)" : String(raw);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    groups = Array.from(counts.entries())
      .map(([key, count]) => ({ key, label: key === "(sin dato)" ? key : fieldValueLabel(groupBy, key), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es"));
    if (top && top > 0) groups = groups.slice(0, top);
  }

  return { operation: intent.operation, count: selected.length, ids, items, groups };
}

// ----------------------------------------------------------------------------
// Traducción híbrida al filtro del mapa
//   - Estructurada (editable) cuando el predicado es un AND de hojas sobre
//     dimensiones distintas del filtro territorial (tax/registry/enablement/
//     support/visualStatus). Semánticamente idéntica al evaluador.
//   - Fallback exacto por lista de IDs para todo lo demás.
// ----------------------------------------------------------------------------
type MapDimension = "tax" | "registry" | "enablement" | "support" | "main";

function leafToDimension(predicate: Predicate): { dimension: MapDimension; values: string[] } | null {
  let values: string[];
  if (predicate.op === "eq") values = [predicate.value];
  else if (predicate.op === "in") values = predicate.value;
  else return null;

  switch (predicate.field) {
    case "taxStatus": return { dimension: "tax", values };
    case "registryStatus": return { dimension: "registry", values };
    case "enablementStatus": return { dimension: "enablement", values };
    case "supportType": return { dimension: "support", values };
    case "visualStatus": {
      // visualStatus usa exactamente getAdministrativeVisualStatus, igual que el
      // filtro main del mapa → traducción exacta.
      const map: Record<string, string> = {
        habilitado: "habilitado",
        deuda: "deuda",
        fuera_zona: "fuera_corredor",
        no_registrado: "no_registrado",
      };
      const mapped = values.map((value) => map[value]).filter(Boolean);
      if (mapped.length !== values.length) return null;
      return { dimension: "main", values: mapped };
    }
    default: return null;
  }
}

function tryStructuredFilter(predicate: Predicate | undefined): TerritorialFilterState | null {
  if (!predicate) return { ...initialTerritorialFilters };
  const leaves = predicate.op === "and" ? predicate.clauses : [predicate];

  const assigned = new Map<MapDimension, string[]>();
  for (const leaf of leaves) {
    const mapped = leafToDimension(leaf);
    if (!mapped) return null;
    if (assigned.has(mapped.dimension)) return null; // dimensión repetida: ambiguo
    assigned.set(mapped.dimension, mapped.values);
  }

  return {
    ...initialTerritorialFilters,
    main: (assigned.get("main") as TerritorialFilterState["main"]) ?? [],
    tax: (assigned.get("tax") as TerritorialFilterState["tax"]) ?? [],
    registry: (assigned.get("registry") as TerritorialFilterState["registry"]) ?? [],
    enablement: (assigned.get("enablement") as TerritorialFilterState["enablement"]) ?? [],
    support: (assigned.get("support") as TerritorialFilterState["support"]) ?? [],
    ids: null,
  };
}

export function intentToFilterState(intent: QueryIntent, carteles: AnalyzedCartel[]): TerritorialFilterState {
  const structured = tryStructuredFilter(intent.predicate);
  if (structured) return structured;
  const ids = intent.predicate
    ? carteles.filter((cartel) => evaluateCartel(cartel, intent.predicate as Predicate)).map((cartel) => String(cartel.properties.id))
    : null;
  return { ...initialTerritorialFilters, ids };
}

/** true si el intent se traduce a filtros estructurados editables (no a IDs). */
export function isStructured(intent: QueryIntent): boolean {
  return tryStructuredFilter(intent.predicate) !== null;
}

// ----------------------------------------------------------------------------
// Descripción legible del predicado (chips / correcciones)
// ----------------------------------------------------------------------------
export interface PredicateChip {
  label: string;
  /** Índice de la hoja en el AND de nivel superior (para poder quitarla). */
  leafIndex: number;
}

const OP_TEXT: Record<string, string> = {
  eq: "es", neq: "no es", in: "es", contains: "contiene", is: "",
  lt: "<", lte: "≤", gt: ">", gte: "≥",
};

function leafText(predicate: Predicate): string {
  switch (predicate.op) {
    case "and":
    case "or":
      return "(condición compuesta)";
    case "is":
      return `${QUERY_FIELDS[predicate.field].label}: ${predicate.value ? "sí" : "no"}`;
    case "in":
      return `${QUERY_FIELDS[predicate.field].label}: ${predicate.value.map((v) => fieldValueLabel(predicate.field, v)).join(" o ")}`;
    case "lt":
    case "lte":
    case "gt":
    case "gte":
      return `${QUERY_FIELDS[predicate.field].label} ${OP_TEXT[predicate.op]} ${predicate.value}`;
    case "eq":
    case "neq":
    case "contains":
      return `${QUERY_FIELDS[predicate.field].label} ${OP_TEXT[predicate.op]} ${fieldValueLabel(predicate.field, predicate.value)}`;
  }
}

/** Chips removibles si el predicado es una conjunción plana (o una sola hoja). */
export function predicateChips(predicate: Predicate | undefined): PredicateChip[] | null {
  if (!predicate) return [];
  const leaves = predicate.op === "and" ? predicate.clauses : [predicate];
  if (leaves.some((leaf) => leaf.op === "and" || leaf.op === "or")) return null;
  return leaves.map((leaf, leafIndex) => ({ label: leafText(leaf), leafIndex }));
}

/** Quita una hoja de un AND plano y devuelve el predicado resultante (o undefined). */
export function removeChip(predicate: Predicate | undefined, leafIndex: number): Predicate | undefined {
  if (!predicate) return undefined;
  if (predicate.op !== "and") return leafIndex === 0 ? undefined : predicate;
  const clauses = predicate.clauses.filter((_, index) => index !== leafIndex);
  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  return { op: "and", clauses };
}

// ----------------------------------------------------------------------------
// Respuesta en lenguaje natural (plantillas deterministas, NO LLM)
// ----------------------------------------------------------------------------
function criteriaText(predicate: Predicate | undefined): string {
  const chips = predicateChips(predicate);
  if (!chips) return "las condiciones indicadas";
  if (chips.length === 0) return "todos los carteles";
  return chips.map((chip) => chip.label).join(" · ");
}

export function buildAnswer(intent: QueryIntent, result: QueryResult): string {
  if (intent.operation === "aggregate" && intent.aggregate) {
    if (result.groups.length === 0) return "No encontré datos para agrupar con esa consulta.";
    const groupLabel = QUERY_FIELDS[intent.aggregate.groupBy].label.toLocaleLowerCase("es");
    const top = result.groups[0];
    return `${top.label} es la ${groupLabel} con más carteles (${top.count}) según ${criteriaText(intent.predicate)}.`;
  }

  const noun = result.count === 1 ? "cartel" : "carteles";
  const verb = result.count === 1 ? "cumple" : "cumplen";
  if (result.count === 0) return `No hay carteles que cumplan: ${criteriaText(intent.predicate)}.`;
  return `Hay ${result.count} ${noun} que ${verb}: ${criteriaText(intent.predicate)}.`;
}
