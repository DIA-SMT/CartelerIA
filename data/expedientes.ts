// ============================================================================
// Modelo configurable de expedientes — Fase 6
// ----------------------------------------------------------------------------
// Única fuente de verdad para la UI (labels, colores, orden, transiciones).
// El catálogo equivalente en Supabase se siembra con estas mismas claves
// (ver supabase/migrations/*_expedientes.sql).
// ============================================================================

export type ExpedienteState =
  | "abierto"
  | "en_tramite"
  | "notificado"
  | "resuelto"
  | "archivado";

export type ExpedienteStateCategory = "inicial" | "proceso" | "cierre";

export interface ExpedienteStateConfig {
  key: ExpedienteState;
  label: string;
  description: string;
  category: ExpedienteStateCategory;
  order: number;
  color: string;
  isFinal: boolean;
  allowedNext: ExpedienteState[];
}

export const EXPEDIENTE_STATES: Record<ExpedienteState, ExpedienteStateConfig> = {
  abierto: {
    key: "abierto",
    label: "Abierto",
    description: "Expediente recién iniciado para el cartel.",
    category: "inicial",
    order: 10,
    color: "#0166FF",
    isFinal: false,
    allowedNext: ["en_tramite", "archivado"],
  },
  en_tramite: {
    key: "en_tramite",
    label: "En trámite",
    description: "En análisis y gestión administrativa.",
    category: "proceso",
    order: 20,
    color: "#6366f1",
    isFinal: false,
    allowedNext: ["notificado", "resuelto", "archivado"],
  },
  notificado: {
    key: "notificado",
    label: "Notificado",
    description: "Se notificó formalmente al responsable.",
    category: "proceso",
    order: 30,
    color: "#f97316",
    isFinal: false,
    allowedNext: ["en_tramite", "resuelto", "archivado"],
  },
  resuelto: {
    key: "resuelto",
    label: "Resuelto",
    description: "Situación resuelta; a la espera de archivo.",
    category: "cierre",
    order: 40,
    color: "#16a34a",
    isFinal: true,
    allowedNext: ["archivado"],
  },
  archivado: {
    key: "archivado",
    label: "Archivado",
    description: "Expediente cerrado y archivado.",
    category: "cierre",
    order: 50,
    color: "#475569",
    isFinal: true,
    allowedNext: [],
  },
};

export const EXPEDIENTE_STATE_ORDER: ExpedienteStateConfig[] = Object.values(
  EXPEDIENTE_STATES,
).sort((a, b) => a.order - b.order);

export const DEFAULT_EXPEDIENTE_STATE: ExpedienteState = "abierto";

export function isExpedienteState(value: unknown): value is ExpedienteState {
  return typeof value === "string" && value in EXPEDIENTE_STATES;
}

export function getExpedienteState(value: unknown): ExpedienteStateConfig {
  return isExpedienteState(value)
    ? EXPEDIENTE_STATES[value]
    : EXPEDIENTE_STATES[DEFAULT_EXPEDIENTE_STATE];
}

/** Verifica si es válido pasar de `from` a `to` según el modelo. */
export function canTransition(from: ExpedienteState, to: ExpedienteState): boolean {
  return EXPEDIENTE_STATES[from].allowedNext.includes(to);
}
