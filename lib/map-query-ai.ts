import { parseQueryIntent, type QueryIntent } from "@/data/map-query";
import { interpretQuestion } from "./map-query-interpreter";

export type InterpretSource = "ai" | "rules";

export interface InterpretResult {
  intent: QueryIntent;
  source: InterpretSource;
}

/**
 * Interpreta la pregunta pidiéndole a Claude (vía /api/ask) que produzca el
 * QueryIntent. Si la IA no está configurada, falla o devuelve algo inválido,
 * cae al intérprete por reglas. La salida SIEMPRE se re-valida con
 * parseQueryIntent antes de usarse: nunca se confía en la respuesta cruda.
 */
export async function interpretQuestionSmart(question: string): Promise<InterpretResult> {
  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (response.ok) {
      const data = (await response.json()) as { intent?: unknown };
      const intent = parseQueryIntent(data.intent);
      if (intent) return { intent, source: "ai" };
    }
  } catch {
    // red caída o endpoint ausente → fallback
  }
  return { intent: interpretQuestion(question), source: "rules" };
}
