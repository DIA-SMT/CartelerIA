// ============================================================================
// Modelo configurable de inspecciones — Fase 3
// ----------------------------------------------------------------------------
// Única fuente de verdad para la UI. NO dispersar strings de estado en
// componentes: importar siempre desde este módulo (labels, colores, orden y
// transiciones permitidas). El catálogo equivalente en Supabase se siembra a
// partir de estas mismas claves (ver supabase/migrations/*_add_inspecciones.sql).
// ============================================================================

/** Estados oficiales del ciclo de vida de una inspección. */
export type InspectionState =
  | "nuevo_relevamiento"
  | "pendiente_revision"
  | "inspeccion_programada"
  | "inspeccionado"
  | "regular"
  | "con_observaciones"
  | "notificado"
  | "en_regularizacion"
  | "regularizado"
  | "derivado_expediente"
  | "cerrado";

/** Agrupación semántica para presentación (timelines, filtros, badges). */
export type InspectionStateCategory =
  | "inicial"
  | "proceso"
  | "resultado"
  | "regularizacion"
  | "cierre";

export interface InspectionStateConfig {
  key: InspectionState;
  label: string;
  description: string;
  category: InspectionStateCategory;
  /** Orden de avance sugerido para timelines. No fuerza la transición. */
  order: number;
  /** Color semántico del estado (no decorativo). */
  color: string;
  /** Estado terminal: no admite avances posteriores. */
  isFinal: boolean;
  /** Transiciones permitidas desde este estado. Vacío en estados finales. */
  allowedNext: InspectionState[];
}

export const INSPECTION_STATES: Record<InspectionState, InspectionStateConfig> = {
  nuevo_relevamiento: {
    key: "nuevo_relevamiento",
    label: "Nuevo relevamiento",
    description: "Cartel recién registrado, sin revisión administrativa.",
    category: "inicial",
    order: 10,
    color: "#0166FF",
    isFinal: false,
    allowedNext: ["pendiente_revision", "inspeccion_programada"],
  },
  pendiente_revision: {
    key: "pendiente_revision",
    label: "Pendiente de revisión",
    description: "A la espera de análisis por parte del área.",
    category: "inicial",
    order: 20,
    color: "#2DB0FF",
    isFinal: false,
    allowedNext: ["inspeccion_programada", "derivado_expediente"],
  },
  inspeccion_programada: {
    key: "inspeccion_programada",
    label: "Inspección programada",
    description: "Visita agendada para verificación en territorio.",
    category: "proceso",
    order: 30,
    color: "#6366f1",
    isFinal: false,
    allowedNext: ["inspeccionado"],
  },
  inspeccionado: {
    key: "inspeccionado",
    label: "Inspeccionado",
    description: "Inspección realizada; pendiente de resultado.",
    category: "proceso",
    order: 40,
    color: "#0ea5e9",
    isFinal: false,
    allowedNext: ["regular", "con_observaciones"],
  },
  regular: {
    key: "regular",
    label: "Regular",
    description: "Cumple con la normativa vigente.",
    category: "resultado",
    order: 50,
    color: "#16a34a",
    isFinal: false,
    allowedNext: ["cerrado"],
  },
  con_observaciones: {
    key: "con_observaciones",
    label: "Con observaciones",
    description: "Presenta irregularidades que requieren acción.",
    category: "resultado",
    order: 60,
    color: "#eab308",
    isFinal: false,
    allowedNext: ["notificado", "derivado_expediente"],
  },
  notificado: {
    key: "notificado",
    label: "Notificado",
    description: "Se notificó formalmente al responsable.",
    category: "regularizacion",
    order: 70,
    color: "#f97316",
    isFinal: false,
    allowedNext: ["en_regularizacion", "derivado_expediente"],
  },
  en_regularizacion: {
    key: "en_regularizacion",
    label: "En regularización",
    description: "El responsable está subsanando las observaciones.",
    category: "regularizacion",
    order: 80,
    color: "#f59e0b",
    isFinal: false,
    allowedNext: ["regularizado", "derivado_expediente"],
  },
  regularizado: {
    key: "regularizado",
    label: "Regularizado",
    description: "Observaciones subsanadas; situación normalizada.",
    category: "cierre",
    order: 90,
    color: "#16a34a",
    isFinal: true,
    allowedNext: [],
  },
  derivado_expediente: {
    key: "derivado_expediente",
    label: "Derivado a expediente",
    description: "Se elevó a expediente administrativo para seguimiento.",
    category: "cierre",
    order: 100,
    color: "#dc2626",
    isFinal: false,
    allowedNext: ["cerrado"],
  },
  cerrado: {
    key: "cerrado",
    label: "Cerrado",
    description: "Trámite finalizado; sin acciones pendientes.",
    category: "cierre",
    order: 110,
    color: "#475569",
    isFinal: true,
    allowedNext: [],
  },
};

/** Lista ordenada por `order`, útil para timelines y selects. */
export const INSPECTION_STATE_ORDER: InspectionStateConfig[] = Object.values(
  INSPECTION_STATES,
).sort((a, b) => a.order - b.order);

/** Estado por defecto de una inspección recién creada. */
export const DEFAULT_INSPECTION_STATE: InspectionState = "nuevo_relevamiento";

export const INSPECTION_CATEGORY_LABELS: Record<InspectionStateCategory, string> = {
  inicial: "Inicial",
  proceso: "En proceso",
  resultado: "Resultado",
  regularizacion: "Regularización",
  cierre: "Cierre",
};

/** Type guard: valida que un string arbitrario sea un estado conocido. */
export function isInspectionState(value: unknown): value is InspectionState {
  return typeof value === "string" && value in INSPECTION_STATES;
}

/** Devuelve la config del estado o el estado por defecto si no es válido. */
export function getInspectionState(value: unknown): InspectionStateConfig {
  return isInspectionState(value)
    ? INSPECTION_STATES[value]
    : INSPECTION_STATES[DEFAULT_INSPECTION_STATE];
}

export function inspectionStateLabel(value: unknown): string {
  return getInspectionState(value).label;
}

export function inspectionStateColor(value: unknown): string {
  return getInspectionState(value).color;
}

/** Verifica si es válido pasar de `from` a `to` según el modelo. */
export function canTransition(from: InspectionState, to: InspectionState): boolean {
  return INSPECTION_STATES[from].allowedNext.includes(to);
}

// ----------------------------------------------------------------------------
// Configuración del formulario mobile-first por pasos (Fase 3, incremento 2).
// Se define acá para que los pasos y sus campos también sean configurables y
// no queden dispersos en el componente del formulario.
// ----------------------------------------------------------------------------

export type InspectionFormStepId =
  | "identificacion"
  | "caracteristicas"
  | "administrativa"
  | "evidencia"
  | "confirmacion";

export interface InspectionFormStepConfig {
  id: InspectionFormStepId;
  title: string;
  description: string;
  order: number;
}

export const INSPECTION_FORM_STEPS: InspectionFormStepConfig[] = [
  {
    id: "identificacion",
    title: "Identificación",
    description: "Cartel, empresa y ubicación.",
    order: 1,
  },
  {
    id: "caracteristicas",
    title: "Características físicas",
    description: "Tipo de soporte y dimensiones.",
    order: 2,
  },
  {
    id: "administrativa",
    title: "Situación administrativa",
    description: "Registro, habilitación y tributos.",
    order: 3,
  },
  {
    id: "evidencia",
    title: "Evidencia",
    description: "Fotografías y observaciones.",
    order: 4,
  },
  {
    id: "confirmacion",
    title: "Confirmación",
    description: "Resumen antes de guardar.",
    order: 5,
  },
];

/**
 * Superficie = ancho × alto, redondeada a 2 decimales.
 * Devuelve null si falta algún valor o si alguno es inválido/negativo.
 * Refleja la columna generada `superficie_m2` de la tabla `inspecciones`.
 */
export function computeSurface(
  widthMeters: number | null | undefined,
  heightMeters: number | null | undefined,
): number | null {
  if (widthMeters == null || heightMeters == null) return null;
  if (!Number.isFinite(widthMeters) || !Number.isFinite(heightMeters)) return null;
  if (widthMeters < 0 || heightMeters < 0) return null;
  return Math.round(widthMeters * heightMeters * 100) / 100;
}
