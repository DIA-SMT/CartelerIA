// ============================================================================
// "Preguntale al mapa" — Intérprete por reglas (Fase 4a, sin LLM)
// ----------------------------------------------------------------------------
// Traduce una pregunta en español a un QueryIntent usando keywords. Es una
// implementación de la MISMA interfaz que después ocupará Claude (4c): recibe
// texto y devuelve solo la estructura; nunca cuenta ni ve el GeoJSON.
// El pipeline completo (executor + mapa + validación) se construye y valida con
// este intérprete antes de conectar el LLM.
// ============================================================================

import type { Predicate, QueryField, QueryIntent } from "@/data/map-query";

function normalize(text: string): string {
  return text.toLocaleLowerCase("es").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

interface Rule {
  test: RegExp;
  leaf: Predicate;
  label: string;
}

// El ORDEN importa: reglas más específicas primero (ej. "sin habilitación"
// antes que "habilitado").
const RULES: Rule[] = [
  { test: /\bsin habilitac|\bno habilitad|\bno habilitab/, leaf: { field: "enablementStatus", op: "eq", value: "no_habilitable" }, label: "No habilitable" },
  { test: /\bfuera de (zona|corredor)|\bfuera de la zona|\bfuera zona/, leaf: { field: "visualStatus", op: "eq", value: "fuera_zona" }, label: "Fuera de zona permitida" },
  { test: /\bdentro de(l)? corredor|\ben corredor|\bsobre corredor/, leaf: { field: "analysisStatus", op: "eq", value: "dentro_corredor" }, label: "Dentro de corredor" },
  { test: /\bhabilitad/, leaf: { field: "visualStatus", op: "eq", value: "habilitado" }, label: "Habilitado" },
  { test: /\bcon deuda|\bdeuda|\bdeben|\bdeudor/, leaf: { field: "visualStatus", op: "eq", value: "deuda" }, label: "Con deuda" },
  { test: /\bno registrad|\bsin registro|\bno inscrip/, leaf: { field: "visualStatus", op: "eq", value: "no_registrado" }, label: "No registrado" },
  { test: /\bpantalla|\bled\b/, leaf: { field: "supportType", op: "eq", value: "led" }, label: "Pantalla LED" },
  { test: /\bgigantograf/, leaf: { field: "supportType", op: "eq", value: "gigantografia" }, label: "Gigantografía" },
  { test: /\bmedianera/, leaf: { field: "supportType", op: "eq", value: "medianera" }, label: "Medianera" },
  { test: /\bcerco|\bcerca de obra|\bobra\b/, leaf: { field: "supportType", op: "eq", value: "cerca_obra" }, label: "Cerco de obra" },
  { test: /\briesgos|\bprioridad alta|\bcritic|\burgent/, leaf: { field: "controlPriority", op: "in", value: ["alta", "critica"] }, label: "Prioridad alta o crítica" },
  { test: /\bzona(s)? sensible|\bsensible|\bescuela|\bhospital|\bplaza/, leaf: { field: "sensitiveZone", op: "is", value: true }, label: "En zona sensible" },
];

// Conceptos que la pregunta puede mencionar pero NO son consultables con los
// datos disponibles. Se reportan en `unsupported` para ser transparentes.
const UNSUPPORTED: { test: RegExp; term: string }[] = [
  { test: /\balquilad|\balquiler|\barrend/, term: "alquiler" },
  { test: /\bpropietari|\bdueñ|\btitular/, term: "propietario" },
  { test: /\bvencimiento|\bvence|\bexpir/, term: "vencimiento" },
  { test: /\bantigüedad|\bantiguedad|\baño de|\bfecha de instal/, term: "antigüedad" },
  { test: /\binfracci|\bmulta/, term: "infracciones/multas" },
];

function buildExplanation(operation: string, labels: string[], aggregateField: QueryField | null): string {
  if (aggregateField === "empresa") {
    return labels.length > 0
      ? `Ranking de empresas por cantidad de carteles, filtrando por: ${labels.join(" · ")}.`
      : "Ranking de empresas por cantidad de carteles.";
  }
  const action = operation === "count" ? "Conté" : "Busqué";
  return labels.length > 0
    ? `${action} los carteles con: ${labels.join(" · ")}.`
    : `${action} todos los carteles (no identifiqué filtros en la pregunta).`;
}

export function interpretQuestion(question: string): QueryIntent {
  const q = normalize(question);

  // Dominio de inspecciones (dataset Supabase). "observaciones" → estado con_observaciones.
  if (/\bobservacion|\bobservad/.test(q)) {
    const predicate: Predicate = { field: "estadoInspeccion", op: "eq", value: "con_observaciones" };
    const wantsRanking = /\bempresa/.test(q) && /\b(mas|mayor|top|ranking|mejor)\b/.test(q);
    if (wantsRanking) {
      return {
        operation: "aggregate",
        dataset: "inspecciones",
        predicate,
        aggregate: { groupBy: "empresaInspeccion", top: 5 },
        applyToMap: false,
        unsupported: [],
        explanation: "Ranking de empresas por inspecciones con observaciones.",
      };
    }
    return {
      operation: "count",
      dataset: "inspecciones",
      predicate,
      applyToMap: false,
      unsupported: [],
      explanation: "Conté las inspecciones con observaciones.",
    };
  }

  const matched = RULES.filter((rule) => rule.test.test(q));
  const leaves = matched.map((rule) => rule.leaf);
  const labels = matched.map((rule) => rule.label);
  const unsupported = UNSUPPORTED.filter((item) => item.test.test(q)).map((item) => item.term);

  // Detección de operación
  const isAggregateEmpresa = /\b(que|cual|cuales|ranking|top)\b/.test(q) && /\bempresa/.test(q) && /\b(mas|mayor|top|ranking|mejor)\b/.test(q);
  const isCount = /\bcuant|\bcantidad|\bnumero de|\bnro de|\btotal de/.test(q);
  const operation: QueryIntent["operation"] = isAggregateEmpresa ? "aggregate" : isCount ? "count" : "list";

  let predicate: Predicate | undefined;
  if (leaves.length === 1) predicate = leaves[0];
  else if (leaves.length > 1) predicate = { op: "and", clauses: leaves };

  const intent: QueryIntent = {
    operation,
    predicate,
    applyToMap: operation === "list",
    unsupported,
    explanation: buildExplanation(operation, labels, isAggregateEmpresa ? "empresa" : null),
  };
  if (isAggregateEmpresa) intent.aggregate = { groupBy: "empresa", top: 5 };

  return intent;
}
