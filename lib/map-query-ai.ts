import type { QueryIntent } from "@/data/map-query";
import { interpretQuestion } from "./map-query-interpreter";

export type InterpretSource = "ai" | "rules";

export interface InterpretResult {
  intent: QueryIntent;
  source: InterpretSource;
}

/**
 * Interpreta la consulta íntegramente en el navegador mediante reglas
 * deterministas. El texto escrito por el usuario no se envía a un proveedor de
 * IA ni a una API del proyecto.
 *
 * Se conserva la interfaz asíncrona para no acoplar la UI al mecanismo de
 * interpretación y para mantener compatibilidad con los llamadores existentes.
 */
export async function interpretQuestionSmart(question: string): Promise<InterpretResult> {
  return { intent: interpretQuestion(question), source: "rules" };
}
