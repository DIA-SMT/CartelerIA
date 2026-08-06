import type { LoadResult } from "@/data/approvals";
import { isAppRole, type AppRole } from "./roles";
import { supabase } from "./supabase";

/** Mismo mínimo que exigen `guardar_articulo` y `cambiar_estado_articulo`. */
export const MOTIVO_MIN_LENGTH = 12;

export type EstadoArticulo = "propuesto" | "en_revision" | "aprobado" | "descartado";
export type OrigenArticulo = "borrador_recibido" | "redactado" | "asistente";

export const ESTADO_ARTICULO_LABELS: Record<EstadoArticulo, string> = {
  propuesto: "Propuesto",
  en_revision: "En revisión",
  aprobado: "Aprobado",
  descartado: "Descartado",
};

export const ESTADO_ARTICULO_COLORS: Record<EstadoArticulo, string> = {
  propuesto: "#64748b",
  en_revision: "#f59e0b",
  aprobado: "#16a34a",
  descartado: "#dc2626",
};

export const ORIGEN_ARTICULO_LABELS: Record<OrigenArticulo, string> = {
  borrador_recibido: "Del borrador",
  redactado: "Redactado",
  asistente: "Asistido",
};

export interface ProyectoNorma {
  id: string;
  titulo: string;
  objeto: string | null;
  estado: string;
}

export interface ArticuloNorma {
  id: string;
  numero: number | null;
  orden: number;
  sumilla: string | null;
  texto: string;
  estado: EstadoArticulo;
  origen: OrigenArticulo;
  /** Texto del borrador recibido. null en artículos redactados desde cero. */
  textoOriginal: string | null;
  aprobadoEn: string | null;
  actualizadoEn: string;
}

export interface VersionArticulo {
  id: string;
  version: number;
  texto: string;
  sumilla: string | null;
  origen: OrigenArticulo;
  autorRol: AppRole | null;
  motivo: string | null;
  creadoEn: string;
}

function esEstado(value: unknown): value is EstadoArticulo {
  return value === "propuesto" || value === "en_revision"
    || value === "aprobado" || value === "descartado";
}

function esOrigen(value: unknown): value is OrigenArticulo {
  return value === "borrador_recibido" || value === "redactado" || value === "asistente";
}

/**
 * Proyecto activo. La pantalla muestra uno solo; el modelo admite varios desde
 * el principio porque normalizar después, con datos adentro, sale caro.
 */
export async function loadProyectoActivo(): Promise<LoadResult<ProyectoNorma | null>> {
  if (!supabase) return { ok: false, data: null, error: "Supabase no está configurado." };
  const { data, error } = await supabase
    .from("norma_proyecto")
    .select("id, titulo, objeto, estado")
    .order("creado_en", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    return { ok: false, data: null, error: "No se pudo cargar el proyecto de ordenanza." };
  }
  if (!data) return { ok: true, data: null, error: null };
  return {
    ok: true,
    data: {
      id: data.id as string,
      titulo: data.titulo as string,
      objeto: (data.objeto as string | null) ?? null,
      estado: data.estado as string,
    },
    error: null,
  };
}

export async function loadArticulos(proyectoId: string): Promise<LoadResult<ArticuloNorma[]>> {
  if (!supabase) return { ok: false, data: [], error: "Supabase no está configurado." };
  const { data, error } = await supabase
    .from("norma_articulo")
    .select("id, numero, orden, sumilla, texto, estado, origen, texto_original, aprobado_en, actualizado_en")
    .eq("proyecto_id", proyectoId)
    .order("orden", { ascending: true });
  if (error || !data) {
    return { ok: false, data: [], error: "No se pudo cargar el articulado." };
  }

  const articulos: ArticuloNorma[] = [];
  for (const row of data as Record<string, unknown>[]) {
    if (typeof row.id !== "string" || !esEstado(row.estado) || !esOrigen(row.origen)) {
      return { ok: false, data: [], error: "El articulado devolvió un contrato inesperado." };
    }
    articulos.push({
      id: row.id,
      numero: typeof row.numero === "number" ? row.numero : null,
      orden: typeof row.orden === "number" ? row.orden : 0,
      sumilla: typeof row.sumilla === "string" ? row.sumilla : null,
      texto: typeof row.texto === "string" ? row.texto : "",
      estado: row.estado,
      origen: row.origen,
      textoOriginal: typeof row.texto_original === "string" ? row.texto_original : null,
      aprobadoEn: typeof row.aprobado_en === "string" ? row.aprobado_en : null,
      actualizadoEn: typeof row.actualizado_en === "string" ? row.actualizado_en : "",
    });
  }
  return { ok: true, data: articulos, error: null };
}

export async function loadVersiones(articuloId: string): Promise<LoadResult<VersionArticulo[]>> {
  if (!supabase) return { ok: false, data: [], error: "Supabase no está configurado." };
  const { data, error } = await supabase
    .from("norma_articulo_version")
    .select("id, version, texto, sumilla, origen, autor_rol, motivo, creado_en")
    .eq("articulo_id", articuloId)
    .order("version", { ascending: false });
  if (error || !data) {
    return { ok: false, data: [], error: "No se pudo cargar el historial del artículo." };
  }
  const versiones: VersionArticulo[] = [];
  for (const row of data as Record<string, unknown>[]) {
    if (typeof row.id !== "string" || typeof row.version !== "number" || !esOrigen(row.origen)) {
      return { ok: false, data: [], error: "El historial devolvió un contrato inesperado." };
    }
    versiones.push({
      id: row.id,
      version: row.version,
      texto: typeof row.texto === "string" ? row.texto : "",
      sumilla: typeof row.sumilla === "string" ? row.sumilla : null,
      origen: row.origen,
      autorRol: isAppRole(row.autor_rol) ? row.autor_rol : null,
      motivo: typeof row.motivo === "string" ? row.motivo : null,
      creadoEn: typeof row.creado_en === "string" ? row.creado_en : "",
    });
  }
  return { ok: true, data: versiones, error: null };
}

/**
 * Los mensajes de las RPC son deliberados y le sirven a quien redacta. Se
 * traducen contra esta lista en vez de mostrar el texto crudo de PostgreSQL:
 * un error inesperado no debe volcar detalle de la base en pantalla.
 */
const ERRORES: { match: RegExp; message: string }[] = [
  { match: /aprobado debe volver a revision/i, message: "Este artículo está aprobado. Devolvelo a revisión antes de editarlo." },
  { match: /descartado no se edita/i, message: "Un artículo descartado no se edita. Volvelo a propuesto primero." },
  { match: /motivo del cambio es obligatorio/i, message: `Contá qué cambiaste y por qué (mínimo ${MOTIVO_MIN_LENGTH} caracteres).` },
  { match: /fundamento de al menos/i, message: `El cambio de estado necesita un fundamento de al menos ${MOTIVO_MIN_LENGTH} caracteres.` },
  { match: /exige rol administrador o coordinador/i, message: "Aprobar un artículo exige rol administrador o coordinador." },
  { match: /exige un rol operativo/i, message: "Tu rol no permite escribir el articulado." },
  { match: /rol consulta no modifica/i, message: "El rol consulta puede observar, pero no modificar el articulado." },
  { match: /demasiado corto/i, message: "El texto del artículo es demasiado corto." },
];

function traducir(mensaje: string, porDefecto: string): string {
  return ERRORES.find((item) => item.match.test(mensaje))?.message ?? porDefecto;
}

export interface ResultadoEscritura {
  ok: boolean;
  error: string | null;
}

export async function guardarArticulo(input: {
  articuloId: string;
  texto: string;
  sumilla: string | null;
  motivo: string;
  origen?: OrigenArticulo;
}): Promise<ResultadoEscritura> {
  if (!supabase) return { ok: false, error: "Supabase no está configurado." };
  const { error } = await supabase.rpc("guardar_articulo", {
    p_articulo_id: input.articuloId,
    p_texto: input.texto,
    p_sumilla: input.sumilla,
    p_motivo: input.motivo,
    p_origen: input.origen ?? "redactado",
  });
  if (error) return { ok: false, error: traducir(error.message, "No se pudo guardar el artículo.") };
  return { ok: true, error: null };
}

export async function cambiarEstadoArticulo(
  articuloId: string,
  estado: EstadoArticulo,
  fundamento: string,
): Promise<ResultadoEscritura> {
  if (!supabase) return { ok: false, error: "Supabase no está configurado." };
  const { error } = await supabase.rpc("cambiar_estado_articulo", {
    p_articulo_id: articuloId,
    p_estado: estado,
    p_fundamento: fundamento,
  });
  if (error) return { ok: false, error: traducir(error.message, "No se pudo cambiar el estado.") };
  return { ok: true, error: null };
}

export async function crearArticulo(input: {
  proyectoId: string;
  texto: string;
  sumilla: string | null;
  origen?: "redactado" | "asistente";
}): Promise<ResultadoEscritura> {
  if (!supabase) return { ok: false, error: "Supabase no está configurado." };
  const { error } = await supabase.rpc("crear_articulo", {
    p_proyecto_id: input.proyectoId,
    p_texto: input.texto,
    p_sumilla: input.sumilla,
    p_origen: input.origen ?? "redactado",
  });
  if (error) return { ok: false, error: traducir(error.message, "No se pudo crear el artículo.") };
  return { ok: true, error: null };
}
