// ============================================================================
// "Preguntale al mapa" — Esquema de intención/consulta (Fase 4a)
// ----------------------------------------------------------------------------
// Única fuente de verdad del "lenguaje" de consulta. La IA (o el intérprete por
// reglas) SOLO produce un QueryIntent con estos campos y valores; NUNCA recibe
// el GeoJSON para contar. La ejecución real vive en lib/map-query-engine.ts.
//
// Los campos y sus valores están anclados 1:1 a AnalyzedCartel.properties y a
// los estados de data/territorial.ts. Si un valor no existe acá, no es
// consultable (y el intérprete debe reportarlo en `unsupported`).
// ============================================================================

import { INSPECTION_STATE_ORDER } from "@/data/inspections";

/** Origen de datos de una consulta. */
export type DatasetKind = "carteles" | "inspecciones";

/** Campos consultables (carteles territoriales + inspecciones de Supabase). */
export type QueryField =
  // Dataset "carteles"
  | "analysisStatus"
  | "visualStatus"
  | "taxStatus"
  | "registryStatus"
  | "enablementStatus"
  | "supportType"
  | "controlPriority"
  | "sensitiveZone"
  | "empresa"
  | "distanceToCorridorM"
  | "distanceToAllowedPlaceM"
  // Dataset "inspecciones"
  | "estadoInspeccion"
  | "empresaInspeccion"
  | "superficieM2Inspeccion";

export type FieldKind = "enum" | "boolean" | "text" | "number";

export interface FieldConfig {
  field: QueryField;
  label: string;
  kind: FieldKind;
  /** Dataset al que pertenece el campo. Ausente = "carteles". */
  dataset?: DatasetKind;
  /** Valores válidos (solo enum): clave interna + etiqueta para UI. */
  values?: { value: string; label: string }[];
}

export function fieldDataset(field: QueryField): DatasetKind {
  return QUERY_FIELDS[field].dataset ?? "carteles";
}

export const QUERY_FIELDS: Record<QueryField, FieldConfig> = {
  analysisStatus: {
    field: "analysisStatus",
    label: "Situación territorial",
    kind: "enum",
    values: [
      { value: "dentro_corredor", label: "Dentro de corredor" },
      { value: "cerca_lugar_permitido", label: "Requiere revisión" },
      { value: "fuera_zona_permitida", label: "Fuera de zona permitida" },
    ],
  },
  visualStatus: {
    field: "visualStatus",
    label: "Estado administrativo",
    kind: "enum",
    values: [
      { value: "habilitado", label: "Habilitado" },
      { value: "deuda", label: "Con deuda" },
      { value: "fuera_zona", label: "Fuera de zona permitida" },
      { value: "no_registrado", label: "No registrado" },
    ],
  },
  taxStatus: {
    field: "taxStatus",
    label: "Estado tributario",
    kind: "enum",
    values: [
      { value: "paga", label: "Paga" },
      { value: "no_paga", label: "No paga" },
      { value: "deuda", label: "Con deuda" },
      { value: "sin_datos", label: "Sin datos" },
    ],
  },
  registryStatus: {
    field: "registryStatus",
    label: "Estado registral",
    kind: "enum",
    values: [
      { value: "registrado", label: "Registrado" },
      { value: "no_registrado", label: "No registrado" },
      { value: "incompleto", label: "Incompleto" },
      { value: "sin_datos", label: "Sin datos" },
    ],
  },
  enablementStatus: {
    field: "enablementStatus",
    label: "Habilitación",
    kind: "enum",
    values: [
      { value: "habilitado", label: "Habilitado" },
      { value: "habilitable", label: "Habilitable" },
      { value: "no_habilitable", label: "No habilitable" },
      { value: "requiere_revision", label: "Requiere revisión" },
    ],
  },
  supportType: {
    field: "supportType",
    label: "Tipo de soporte",
    kind: "enum",
    values: [
      { value: "led", label: "Pantalla LED" },
      { value: "cartel_tradicional", label: "Cartel tradicional" },
      { value: "medianera", label: "Medianera" },
      { value: "cerca_obra", label: "Cerco de obra" },
      { value: "gigantografia", label: "Gigantografía" },
    ],
  },
  controlPriority: {
    field: "controlPriority",
    label: "Prioridad de control",
    kind: "enum",
    values: [
      { value: "baja", label: "Baja" },
      { value: "media", label: "Media" },
      { value: "alta", label: "Alta" },
      { value: "critica", label: "Crítica" },
    ],
  },
  sensitiveZone: { field: "sensitiveZone", label: "Zona sensible", kind: "boolean" },
  empresa: { field: "empresa", label: "Empresa", kind: "text" },
  distanceToCorridorM: { field: "distanceToCorridorM", label: "Distancia al corredor (m)", kind: "number" },
  distanceToAllowedPlaceM: { field: "distanceToAllowedPlaceM", label: "Distancia a lugar permitido (m)", kind: "number" },
  // Dataset "inspecciones" (tabla Supabase). Los valores de estado salen de
  // data/inspections.ts (única fuente).
  estadoInspeccion: {
    field: "estadoInspeccion",
    label: "Estado de inspección",
    kind: "enum",
    dataset: "inspecciones",
    values: INSPECTION_STATE_ORDER.map((state) => ({ value: state.key, label: state.label })),
  },
  empresaInspeccion: { field: "empresaInspeccion", label: "Empresa (inspección)", kind: "text", dataset: "inspecciones" },
  superficieM2Inspeccion: { field: "superficieM2Inspeccion", label: "Superficie (inspección, m²)", kind: "number", dataset: "inspecciones" },
};

export type ComparisonOp = "eq" | "neq" | "in" | "lt" | "lte" | "gt" | "gte" | "is" | "contains";

export type Predicate =
  | { field: QueryField; op: "eq" | "neq" | "contains"; value: string }
  | { field: QueryField; op: "in"; value: string[] }
  | { field: QueryField; op: "lt" | "lte" | "gt" | "gte"; value: number }
  | { field: QueryField; op: "is"; value: boolean }
  | { op: "and" | "or"; clauses: Predicate[] };

export type QueryOperation = "count" | "list" | "aggregate";

export interface QueryIntent {
  operation: QueryOperation;
  /** Origen de datos. Ausente = "carteles". */
  dataset?: DatasetKind;
  /** Qué registros seleccionar. Ausente = todos. */
  predicate?: Predicate;
  /** Solo para operation "aggregate": agrupar y rankear. */
  aggregate?: { groupBy: QueryField; top?: number };
  /** Si el resultado debe reflejarse en el mapa. */
  applyToMap: boolean;
  /** Términos de la pregunta que no se pudieron mapear a un campo/valor. */
  unsupported: string[];
  /** Cómo se interpretó (texto legible; se muestra y se puede corregir). */
  explanation: string;
}

export function isNumericField(field: QueryField): boolean {
  return QUERY_FIELDS[field].kind === "number";
}

export function isQueryField(value: unknown): value is QueryField {
  return typeof value === "string" && value in QUERY_FIELDS;
}

// ----------------------------------------------------------------------------
// Validación runtime — NUNCA confiar en la salida cruda del LLM (o de cualquier
// origen externo). Convierte un objeto arbitrario en un QueryIntent seguro o
// devuelve null. Se usa en el server (Route Handler) y en el cliente.
// ----------------------------------------------------------------------------
function enumValueOk(field: QueryField, value: string): boolean {
  const config = QUERY_FIELDS[field];
  return config.kind !== "enum" || (config.values?.some((item) => item.value === value) ?? false);
}

export function parsePredicate(value: unknown): Predicate | null {
  if (typeof value !== "object" || value === null) return null;
  const p = value as Record<string, unknown>;

  if (p.op === "and" || p.op === "or") {
    if (!Array.isArray(p.clauses) || p.clauses.length === 0) return null;
    const clauses: Predicate[] = [];
    for (const clause of p.clauses) {
      const parsed = parsePredicate(clause);
      if (!parsed) return null;
      clauses.push(parsed);
    }
    return { op: p.op, clauses };
  }

  if (!isQueryField(p.field)) return null;
  const field = p.field;
  const kind = QUERY_FIELDS[field].kind;

  switch (p.op) {
    case "eq":
    case "neq":
      if (typeof p.value !== "string" || !enumValueOk(field, p.value)) return null;
      return { field, op: p.op, value: p.value };
    case "contains":
      if (typeof p.value !== "string") return null;
      return { field, op: "contains", value: p.value };
    case "in": {
      if (!Array.isArray(p.value) || p.value.length === 0) return null;
      const values: string[] = [];
      for (const item of p.value) {
        if (typeof item !== "string" || !enumValueOk(field, item)) return null;
        values.push(item);
      }
      return { field, op: "in", value: values };
    }
    case "lt":
    case "lte":
    case "gt":
    case "gte":
      if (kind !== "number" || typeof p.value !== "number" || !Number.isFinite(p.value)) return null;
      return { field, op: p.op, value: p.value };
    case "is":
      if (kind !== "boolean" || typeof p.value !== "boolean") return null;
      return { field, op: "is", value: p.value };
    default:
      return null;
  }
}

/** Recolecta todos los campos referenciados por un predicado (recursivo). */
function predicateFields(predicate: Predicate): QueryField[] {
  switch (predicate.op) {
    case "and":
    case "or":
      return predicate.clauses.flatMap(predicateFields);
    default:
      return [predicate.field];
  }
}

export function parseQueryIntent(value: unknown): QueryIntent | null {
  if (typeof value !== "object" || value === null) return null;
  const o = value as Record<string, unknown>;

  const operation = o.operation;
  if (operation !== "count" && operation !== "list" && operation !== "aggregate") return null;

  const dataset: DatasetKind = o.dataset === "inspecciones" ? "inspecciones" : "carteles";

  let predicate: Predicate | undefined;
  if (o.predicate != null) {
    const parsed = parsePredicate(o.predicate);
    if (!parsed) return null;
    // Todos los campos del predicado deben pertenecer al dataset de la consulta.
    if (predicateFields(parsed).some((field) => fieldDataset(field) !== dataset)) return null;
    predicate = parsed;
  }

  const intent: QueryIntent = {
    operation,
    dataset,
    predicate,
    applyToMap: typeof o.applyToMap === "boolean" ? o.applyToMap : operation === "list",
    unsupported: Array.isArray(o.unsupported) ? o.unsupported.filter((x): x is string => typeof x === "string") : [],
    explanation: typeof o.explanation === "string" ? o.explanation : "",
  };

  if (operation === "aggregate") {
    const agg = o.aggregate;
    if (typeof agg !== "object" || agg === null) return null;
    const a = agg as Record<string, unknown>;
    if (!isQueryField(a.groupBy) || fieldDataset(a.groupBy) !== dataset) return null;
    intent.aggregate = { groupBy: a.groupBy, top: typeof a.top === "number" ? a.top : undefined };
  }

  return intent;
}

/** Etiqueta legible de un valor enum (o el valor crudo si no es enum). */
export function fieldValueLabel(field: QueryField, value: string): string {
  const config = QUERY_FIELDS[field];
  const match = config.values?.find((item) => item.value === value);
  return match ? match.label : value;
}
