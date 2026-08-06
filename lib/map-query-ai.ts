import {
  parseQueryIntent,
  type QueryIntent,
  type QueryPermissions,
} from "@/data/map-query";
import { interpretQuestion } from "./map-query-interpreter";

export type InterpretSource = "ai" | "rules";

export interface InterpretResult {
  intent: QueryIntent;
  source: InterpretSource;
}

/** Término que se muestra en `unsupported` cuando el rol no alcanza. */
export const FISCAL_RESTRICTED_TERM = "empresa/CUIT (restringido por rol)";

/**
 * Interpreta la consulta íntegramente en el navegador mediante reglas
 * deterministas. El texto escrito por el usuario no se envía a un proveedor de
 * IA ni a una API del proyecto.
 *
 * La intención resultante se revalida siempre con `parseQueryIntent` bajo los
 * permisos de la sesión: el intérprete local puede proponer un ranking por
 * empresa ("¿qué empresa tiene más observaciones?") y esa pregunta reconstruye
 * la razón social aunque el campo no se muestre. Cuando la validación rechaza,
 * se degrada a la consulta sin el agregado y se dice por qué, en vez de
 * devolver un resultado vacío que se leería como "no hay datos".
 *
 * Se conserva la interfaz asíncrona para no acoplar la UI al mecanismo de
 * interpretación y para mantener compatibilidad con los llamadores existentes.
 */
export async function interpretQuestionSmart(
  question: string,
  permissions: QueryPermissions,
): Promise<InterpretResult> {
  const raw = interpretQuestion(question);
  const validated = parseQueryIntent(raw, permissions);
  if (validated) return { intent: validated, source: "rules" };

  const withoutAggregate = parseQueryIntent(
    { ...raw, operation: "count", aggregate: null },
    permissions,
  );
  if (withoutAggregate) {
    return {
      intent: {
        ...withoutAggregate,
        unsupported: [...withoutAggregate.unsupported, FISCAL_RESTRICTED_TERM],
        explanation: `${withoutAggregate.explanation} El desglose por empresa está restringido para tu rol.`,
      },
      source: "rules",
    };
  }

  return {
    intent: {
      operation: "count",
      dataset: raw.dataset,
      applyToMap: false,
      unsupported: [FISCAL_RESTRICTED_TERM],
      explanation: "Esta consulta necesita datos de empresa o CUIT, restringidos para tu rol.",
    },
    source: "rules",
  };
}
