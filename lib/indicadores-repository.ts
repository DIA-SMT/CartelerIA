import type { LoadResult } from "@/data/approvals";
import { supabase } from "./supabase";

/**
 * Procedencia de cada indicador, con el vocabulario acordado en el roadmap.
 * Ningún dato de demostración puede presentarse como situación administrativa
 * real: por eso la procedencia viaja con el número, no en una nota al pie.
 */
export type Procedencia =
  | "territorial_calculado"
  | "administrativo_oficial"
  | "aportado_inspeccion"
  | "pendiente_verificacion"
  | "demostracion";

export const PROCEDENCIA_LABELS: Record<Procedencia, string> = {
  territorial_calculado: "Territorial calculado",
  administrativo_oficial: "Administrativo oficial",
  aportado_inspeccion: "Aportado en inspección",
  pendiente_verificacion: "Pendiente de verificación",
  demostracion: "Demostración",
};

const PROCEDENCIAS = Object.keys(PROCEDENCIA_LABELS) as Procedencia[];

export type Unidad = "porcentaje" | "dias" | "rangos";

export interface RangoIndicador {
  clave: string;
  etiqueta: string;
  cantidad: number;
}

export interface Indicador {
  clave: string;
  etiqueta: string;
  procedencia: Procedencia;
  unidad: Unidad;
  /** false cuando no hay datos suficientes. No se muestra como cero. */
  suficiente: boolean;
  numerador: number | null;
  denominador: number | null;
  valor: number | null;
  rangos: RangoIndicador[];
  detalle: string;
}

export interface PeriodoIndicadores {
  desde: string;
  hasta: string;
  zona: string | null;
}

export interface IndicadoresGestion {
  periodo: PeriodoIndicadores;
  indicadores: Indicador[];
}

export interface FiltrosIndicadores {
  desde?: string | null;
  hasta?: string | null;
  zona?: string | null;
}

function isRango(value: unknown): value is RangoIndicador {
  if (!value || typeof value !== "object") return false;
  const rango = value as Partial<RangoIndicador>;
  return (
    typeof rango.clave === "string"
    && typeof rango.etiqueta === "string"
    && typeof rango.cantidad === "number"
    && Number.isFinite(rango.cantidad)
  );
}

function numeroOpcional(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function toIndicador(value: unknown): Indicador | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.clave !== "string"
    || typeof raw.etiqueta !== "string"
    || typeof raw.detalle !== "string"
    || typeof raw.suficiente !== "boolean"
    || !PROCEDENCIAS.includes(raw.procedencia as Procedencia)
    || (raw.unidad !== "porcentaje" && raw.unidad !== "dias" && raw.unidad !== "rangos")
  ) return null;

  const rangos: RangoIndicador[] = [];
  if (Array.isArray(raw.rangos)) {
    for (const item of raw.rangos) {
      if (!isRango(item)) return null;
      rangos.push(item);
    }
  }

  return {
    clave: raw.clave,
    etiqueta: raw.etiqueta,
    procedencia: raw.procedencia as Procedencia,
    unidad: raw.unidad,
    suficiente: raw.suficiente,
    numerador: numeroOpcional(raw.numerador),
    denominador: numeroOpcional(raw.denominador),
    valor: numeroOpcional(raw.valor),
    rangos,
    detalle: raw.detalle,
  };
}

/**
 * Trae los indicadores agregados. El cálculo entero vive en PostgreSQL: el
 * navegador nunca descarga el registro para contar, y así el resultado no
 * depende de lo que la sesión pueda o no leer.
 *
 * Falla de forma cerrada: un contrato inesperado se trata como error, no se
 * muestran indicadores a medias.
 */
export async function loadIndicadores(
  filtros: FiltrosIndicadores = {},
): Promise<LoadResult<IndicadoresGestion | null>> {
  if (!supabase) {
    return { ok: false, data: null, error: "Supabase no está configurado." };
  }
  const { data, error } = await supabase.rpc("indicadores_gestion", {
    p_desde: filtros.desde ?? null,
    p_hasta: filtros.hasta ?? null,
    p_zona: filtros.zona ?? null,
  });
  if (error || !data || typeof data !== "object") {
    return { ok: false, data: null, error: "No se pudieron calcular los indicadores de gestión." };
  }

  const payload = data as Record<string, unknown>;
  const periodo = payload.periodo as Record<string, unknown> | undefined;
  if (
    !periodo
    || typeof periodo.desde !== "string"
    || typeof periodo.hasta !== "string"
    || !Array.isArray(payload.indicadores)
  ) {
    return { ok: false, data: null, error: "Los indicadores devolvieron un contrato inesperado." };
  }

  const indicadores: Indicador[] = [];
  for (const item of payload.indicadores) {
    const indicador = toIndicador(item);
    if (!indicador) {
      return { ok: false, data: null, error: "Los indicadores devolvieron un contrato inesperado." };
    }
    indicadores.push(indicador);
  }

  return {
    ok: true,
    data: {
      periodo: {
        desde: periodo.desde,
        hasta: periodo.hasta,
        zona: typeof periodo.zona === "string" ? periodo.zona : null,
      },
      indicadores,
    },
    error: null,
  };
}

export interface ZonaDisponible {
  zona: string;
  cantidad: number;
}

export async function loadZonasDisponibles(): Promise<LoadResult<ZonaDisponible[]>> {
  if (!supabase) {
    return { ok: false, data: [], error: "Supabase no está configurado." };
  }
  const { data, error } = await supabase.rpc("zonas_disponibles");
  if (error || !Array.isArray(data)) {
    return { ok: false, data: [], error: "No se pudieron cargar las zonas." };
  }
  const zonas: ZonaDisponible[] = [];
  for (const row of data as Record<string, unknown>[]) {
    if (typeof row.zona !== "string" || typeof row.cantidad !== "number") {
      return { ok: false, data: [], error: "Las zonas devolvieron un contrato inesperado." };
    }
    zonas.push({ zona: row.zona, cantidad: row.cantidad });
  }
  return { ok: true, data: zonas, error: null };
}
