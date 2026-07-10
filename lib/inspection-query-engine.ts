// ============================================================================
// "Preguntale al mapa" — Motor de consultas sobre INSPECCIONES (Fase 4b)
// ----------------------------------------------------------------------------
// Ejecuta un QueryIntent (dataset "inspecciones") sobre los registros reales de
// la tabla Supabase. Reusa el evaluador genérico de map-query-engine. La IA solo
// produce el QueryIntent; el conteo/ranking sale de los datos reales.
// ============================================================================

import { fieldValueLabel, QUERY_FIELDS, type Predicate, type QueryField, type QueryIntent } from "@/data/map-query";
import { getInspectionState } from "@/data/inspections";
import { evaluatePredicate } from "./map-query-engine";
import type { InspectionRecord } from "./inspection-repository";
import type { QueryGroup } from "./map-query-engine";

export interface InspectionQueryResult {
  operation: QueryIntent["operation"];
  count: number;
  groups: QueryGroup[];
}

function getInspectionFieldValue(record: InspectionRecord, field: QueryField): string | number | boolean | null {
  switch (field) {
    case "estadoInspeccion": return record.estado;
    case "empresaInspeccion": return record.empresa;
    case "superficieM2Inspeccion": return record.superficieM2;
    default: return null; // campos de otros datasets no aplican a inspecciones
  }
}

export function evaluateInspection(record: InspectionRecord, predicate: Predicate): boolean {
  return evaluatePredicate(predicate, (field) => getInspectionFieldValue(record, field));
}

export function runInspectionQuery(intent: QueryIntent, records: InspectionRecord[]): InspectionQueryResult {
  const selected = intent.predicate
    ? records.filter((record) => evaluateInspection(record, intent.predicate as Predicate))
    : records;

  let groups: QueryGroup[] = [];
  if (intent.operation === "aggregate" && intent.aggregate) {
    const { groupBy, top } = intent.aggregate;
    const skipEmpty = QUERY_FIELDS[groupBy].kind === "text"; // empresa sin dato no es un grupo real
    const counts = new Map<string, number>();
    for (const record of selected) {
      const raw = getInspectionFieldValue(record, groupBy);
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

  return { operation: intent.operation, count: selected.length, groups };
}

function inspectionCriteria(predicate: Predicate | undefined): string {
  if (!predicate) return "todas las inspecciones";
  switch (predicate.op) {
    case "eq":
      return predicate.field === "estadoInspeccion"
        ? `estado ${getInspectionState(predicate.value).label}`
        : "las condiciones indicadas";
    case "in":
      return predicate.field === "estadoInspeccion"
        ? `estado ${predicate.value.map((v) => getInspectionState(v).label).join(" o ")}`
        : "las condiciones indicadas";
    default:
      return "las condiciones indicadas";
  }
}

export function buildInspectionAnswer(intent: QueryIntent, result: InspectionQueryResult): string {
  if (intent.operation === "aggregate" && intent.aggregate) {
    if (result.groups.length === 0) return "No hay inspecciones cargadas que cumplan esa consulta.";
    const groupLabel = QUERY_FIELDS[intent.aggregate.groupBy].label.toLocaleLowerCase("es");
    const top = result.groups[0];
    return `${top.label} es la ${groupLabel} con más inspecciones (${top.count}) según ${inspectionCriteria(intent.predicate)}.`;
  }
  const noun = result.count === 1 ? "inspección" : "inspecciones";
  if (result.count === 0) return `No hay ${noun} que cumplan: ${inspectionCriteria(intent.predicate)}.`;
  return `Hay ${result.count} ${noun} con ${inspectionCriteria(intent.predicate)}.`;
}
