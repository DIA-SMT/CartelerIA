// ============================================================================
// "Preguntale al mapa" — Intérprete por reglas (Fase 4a, sin LLM)
// ----------------------------------------------------------------------------
// Traduce una pregunta en español a un QueryIntent usando keywords. Es una
// implementación de la MISMA interfaz que después ocupará Claude (4c): recibe
// texto y devuelve solo la estructura; nunca cuenta ni ve el GeoJSON.
// El pipeline completo (executor + mapa + validación) se construye y valida con
// este intérprete antes de conectar el LLM.
// ============================================================================

import type { Predicate, QueryIntent } from "@/data/map-query";

function normalize(text: string): string {
  return text.toLocaleLowerCase("es").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

interface Rule {
  test: RegExp;
  leaf: Predicate;
  label: string;
}

// Solo se interpretan dimensiones respaldadas por las capas territoriales.
const RULES: Rule[] = [
  { test: /\bfuera de (zona|corredor)|\bfuera de la zona|\bfuera zona|\bfuera de (las )?areas analizadas/, leaf: { field: "analysisStatus", op: "eq", value: "fuera_zona_permitida" }, label: "Fuera de las áreas analizadas" },
  { test: /\bdentro de(l)? corredor|\ben corredor|\bsobre corredor/, leaf: { field: "analysisStatus", op: "eq", value: "dentro_corredor" }, label: "Dentro de corredor" },
  { test: /\brequiere revision|\bcerca de (un )?lugar permitido|\bproximidad a (un )?lugar permitido/, leaf: { field: "analysisStatus", op: "eq", value: "cerca_lugar_permitido" }, label: "Requiere revisión territorial" },
];

// Conceptos que la pregunta puede mencionar pero NO son consultables con los
// datos disponibles. Se reportan en `unsupported` para ser transparentes.
const UNSUPPORTED: { test: RegExp; term: string }[] = [
  { test: /\bhabilitac|\bhabilitad|\bhabilitable/, term: "habilitación" },
  { test: /\bdeuda|\bdeben|\bdeudor|\btribut/, term: "deuda/estado tributario" },
  { test: /\bregistrad|\bsin registro|\binscrip/, term: "estado registral" },
  { test: /\bsoporte|\bcartel tradicional|\bpantalla|\bled\b|\bgigantograf|\bmedianera|\bcerco|\bcerca de obra/, term: "tipo de soporte" },
  { test: /\briesgos|\bprioridad|\bcritic|\burgent/, term: "prioridad de control" },
  { test: /\bzona(s)? sensible|\bsensible|\bescuela|\bhospital|\bplaza/, term: "zona sensible" },
  { test: /\bempresa|\brazon social|\bcuit/, term: "empresa/CUIT del cartel" },
  { test: /\balquilad|\balquiler|\barrend/, term: "alquiler" },
  { test: /\bpropietari|\bdueñ|\btitular/, term: "propietario" },
  { test: /\bvencimiento|\bvence|\bexpir/, term: "vencimiento" },
  { test: /\bantigüedad|\bantiguedad|\baño de|\bfecha de instal/, term: "antigüedad" },
  { test: /\binfracci|\bmulta/, term: "infracciones/multas" },
];

function buildExplanation(operation: string, labels: string[]): string {
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
  const isCount = /\bcuant|\bcantidad|\bnumero de|\bnro de|\btotal de/.test(q);
  const operation: QueryIntent["operation"] = isCount ? "count" : "list";

  let predicate: Predicate | undefined;
  if (leaves.length === 1) predicate = leaves[0];
  else if (leaves.length > 1) predicate = { op: "and", clauses: leaves };

  const intent: QueryIntent = {
    operation,
    predicate,
    applyToMap: operation === "list",
    unsupported,
    explanation: buildExplanation(operation, labels),
  };

  return intent;
}
