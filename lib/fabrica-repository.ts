import type { LoadResult } from "@/data/approvals";
import { esClaveParametro, type ClaveParametro } from "./norma-simulador";
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

// ----------------------------------------------------------------------------
// Parámetros y diagnósticos
// ----------------------------------------------------------------------------
export interface ParametroGuardado {
  id: string;
  clave: ClaveParametro;
  valor: number | string[];
  unidad: string | null;
  cita: string;
  fundamento: string | null;
  confirmadoEn: string | null;
}

export interface DiagnosticoGuardado {
  id: string;
  tipo: string;
  severidad: "baja" | "media" | "alta";
  descripcion: string;
  referencia: string | null;
  cita: string | null;
  confianza: string | null;
  generadoEn: string;
  atendidoEn: string | null;
  fundamento: string | null;
}

function valorDeParametro(value: unknown): number | string[] | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return null;
}

export async function loadParametros(articuloId: string): Promise<LoadResult<ParametroGuardado[]>> {
  if (!supabase) return { ok: false, data: [], error: "Supabase no está configurado." };
  const { data, error } = await supabase
    .from("norma_parametro")
    .select("id, clave, valor, unidad, cita, fundamento, confirmado_en")
    .eq("articulo_id", articuloId)
    .order("clave");
  if (error || !data) {
    return { ok: false, data: [], error: "No se pudieron cargar los parámetros del artículo." };
  }
  const parametros: ParametroGuardado[] = [];
  for (const row of data as Record<string, unknown>[]) {
    const valor = valorDeParametro(row.valor);
    if (typeof row.id !== "string" || !esClaveParametro(row.clave) || valor === null) {
      return { ok: false, data: [], error: "Los parámetros devolvieron un contrato inesperado." };
    }
    parametros.push({
      id: row.id,
      clave: row.clave,
      valor,
      unidad: typeof row.unidad === "string" ? row.unidad : null,
      cita: typeof row.cita === "string" ? row.cita : "",
      fundamento: typeof row.fundamento === "string" ? row.fundamento : null,
      confirmadoEn: typeof row.confirmado_en === "string" ? row.confirmado_en : null,
    });
  }
  return { ok: true, data: parametros, error: null };
}

export async function loadDiagnosticos(articuloId: string): Promise<LoadResult<DiagnosticoGuardado[]>> {
  if (!supabase) return { ok: false, data: [], error: "Supabase no está configurado." };
  const { data, error } = await supabase
    .from("norma_diagnostico")
    .select("id, tipo, severidad, descripcion, referencia, cita, datos, generado_en, atendido_en, fundamento")
    .eq("articulo_id", articuloId)
    .order("generado_en", { ascending: false });
  if (error || !data) {
    return { ok: false, data: [], error: "No se pudieron cargar los diagnósticos." };
  }
  const diagnosticos: DiagnosticoGuardado[] = [];
  for (const row of data as Record<string, unknown>[]) {
    if (typeof row.id !== "string" || typeof row.descripcion !== "string") {
      return { ok: false, data: [], error: "Los diagnósticos devolvieron un contrato inesperado." };
    }
    const severidad = row.severidad === "alta" || row.severidad === "media" ? row.severidad : "baja";
    const datos = row.datos as { confianza?: unknown } | null;
    diagnosticos.push({
      id: row.id,
      tipo: typeof row.tipo === "string" ? row.tipo : "vacio",
      severidad,
      descripcion: row.descripcion,
      referencia: typeof row.referencia === "string" ? row.referencia : null,
      cita: typeof row.cita === "string" ? row.cita : null,
      confianza: typeof datos?.confianza === "string" ? datos.confianza : null,
      generadoEn: typeof row.generado_en === "string" ? row.generado_en : "",
      atendidoEn: typeof row.atendido_en === "string" ? row.atendido_en : null,
      fundamento: typeof row.fundamento === "string" ? row.fundamento : null,
    });
  }
  return { ok: true, data: diagnosticos, error: null };
}

/**
 * Diagnósticos de todo el proyecto, para la compuerta de exportación.
 *
 * Se traen solo las tres columnas que la compuerta necesita: no hace falta el
 * texto del hallazgo para saber si bloquea.
 */
export async function loadDiagnosticosDelProyecto(
  proyectoId: string,
): Promise<LoadResult<{ articuloId: string; severidad: string; atendidoEn: string | null }[]>> {
  if (!supabase) return { ok: false, data: [], error: "Supabase no está configurado." };
  const { data: articulos, error: articulosError } = await supabase
    .from("norma_articulo")
    .select("id")
    .eq("proyecto_id", proyectoId);
  if (articulosError || !articulos) {
    return { ok: false, data: [], error: "No se pudo verificar el articulado del proyecto." };
  }
  const ids = (articulos as { id: string }[]).map((fila) => fila.id);
  if (ids.length === 0) return { ok: true, data: [], error: null };

  const { data, error } = await supabase
    .from("norma_diagnostico")
    .select("articulo_id, severidad, atendido_en")
    .in("articulo_id", ids);
  if (error || !data) {
    return { ok: false, data: [], error: "No se pudieron verificar los diagnósticos del proyecto." };
  }
  return {
    ok: true,
    data: (data as Record<string, unknown>[]).map((fila) => ({
      articuloId: String(fila.articulo_id),
      severidad: typeof fila.severidad === "string" ? fila.severidad : "baja",
      atendidoEn: typeof fila.atendido_en === "string" ? fila.atendido_en : null,
    })),
    error: null,
  };
}

export async function confirmarParametro(input: {
  articuloId: string;
  clave: ClaveParametro;
  valor: number | string[];
  unidad: string | null;
  cita: string;
  fundamento: string;
}): Promise<ResultadoEscritura> {
  if (!supabase) return { ok: false, error: "Supabase no está configurado." };
  const { error } = await supabase.rpc("confirmar_parametro", {
    p_articulo_id: input.articuloId,
    p_clave: input.clave,
    p_valor: input.valor,
    p_unidad: input.unidad,
    p_cita: input.cita,
    p_fundamento: input.fundamento,
  });
  if (error) {
    const conocido = /no aparece textualmente/i.test(error.message)
      ? "La cita tiene que estar copiada textualmente del artículo."
      : /cita textual/i.test(error.message)
        ? "Pegá la cita del artículo que sostiene este parámetro (mínimo 25 caracteres)."
        : /rol operativo/i.test(error.message)
          ? "Tu rol no permite confirmar parámetros."
          : null;
    return { ok: false, error: conocido ?? "No se pudo confirmar el parámetro." };
  }
  return { ok: true, error: null };
}

export async function atenderDiagnostico(
  diagnosticoId: string,
  fundamento: string,
): Promise<ResultadoEscritura> {
  if (!supabase) return { ok: false, error: "Supabase no está configurado." };
  const { error } = await supabase.rpc("atender_diagnostico", {
    p_diagnostico_id: diagnosticoId,
    p_fundamento: fundamento,
  });
  if (error) {
    return {
      ok: false,
      error: /rol administrador o coordinador/i.test(error.message)
        ? "Atender un diagnóstico exige rol administrador o coordinador."
        : /fundamento/i.test(error.message)
          ? `El fundamento debe tener al menos ${MOTIVO_MIN_LENGTH} caracteres.`
          : "No se pudo atender el diagnóstico.",
    };
  }
  return { ok: true, error: null };
}

export interface RespuestaAsistente {
  ok: boolean;
  asistido: boolean;
  motivo: string | null;
  fragmentos: { titulo: string; seccion: string | null; contenido: string }[];
  error: string | null;
}

/**
 * Diagnóstico contra la normativa vigente.
 *
 * Devuelve también los fragmentos recuperados cuando la asistencia está
 * deshabilitada: aunque el modelo no redacte, tener a la vista qué dice la
 * norma vigente sobre el tema sigue siendo útil para redactar.
 */
export async function diagnosticarContraVigente(
  articuloId: string,
  texto: string,
): Promise<RespuestaAsistente> {
  const vacio = { ok: false, asistido: false, motivo: null, fragmentos: [], error: "" };
  if (!supabase) return { ...vacio, error: "Supabase no está configurado." };
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { ...vacio, error: "Tu sesión no está vigente." };

  let respuesta: Response;
  try {
    respuesta = await fetch("/api/fabrica", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "diagnosticar_vigente", articuloId, texto }),
    });
  } catch {
    return { ...vacio, error: "No se pudo contactar al servidor." };
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await respuesta.json() as Record<string, unknown>;
  } catch {
    // Se resuelve por el status.
  }
  if (!respuesta.ok) {
    return { ...vacio, error: "No se pudo ejecutar el diagnóstico." };
  }
  const fragmentos = Array.isArray(payload.fragmentos)
    ? payload.fragmentos.filter((item): item is { titulo: string; seccion: string | null; contenido: string } =>
        Boolean(item) && typeof item === "object" && typeof (item as { titulo?: unknown }).titulo === "string")
    : [];
  return {
    ok: true,
    asistido: payload.asistido === true,
    motivo: typeof payload.motivo === "string" ? payload.motivo : null,
    fragmentos,
    error: null,
  };
}

// ----------------------------------------------------------------------------
// Observaciones de las áreas
// ----------------------------------------------------------------------------
export interface Observacion {
  id: string;
  articuloId: string;
  texto: string;
  autorNombre: string | null;
  autorRol: AppRole | null;
  creadoEn: string;
  atendidoEn: string | null;
  fundamento: string | null;
}

function toObservacion(row: Record<string, unknown>): Observacion | null {
  if (typeof row.id !== "string" || typeof row.texto !== "string") return null;
  return {
    id: row.id,
    articuloId: String(row.articulo_id),
    texto: row.texto,
    autorNombre: typeof row.autor_nombre === "string" ? row.autor_nombre : null,
    autorRol: isAppRole(row.autor_rol) ? row.autor_rol : null,
    creadoEn: typeof row.creado_en === "string" ? row.creado_en : "",
    atendidoEn: typeof row.atendido_en === "string" ? row.atendido_en : null,
    fundamento: typeof row.fundamento === "string" ? row.fundamento : null,
  };
}

export async function loadObservaciones(articuloId: string): Promise<LoadResult<Observacion[]>> {
  if (!supabase) return { ok: false, data: [], error: "Supabase no está configurado." };
  const { data, error } = await supabase
    .from("norma_observacion")
    .select("id, articulo_id, texto, autor_nombre, autor_rol, creado_en, atendido_en, fundamento")
    .eq("articulo_id", articuloId)
    .order("creado_en", { ascending: false });
  if (error || !data) {
    return { ok: false, data: [], error: "No se pudieron cargar las observaciones." };
  }
  const observaciones: Observacion[] = [];
  for (const row of data as Record<string, unknown>[]) {
    const observacion = toObservacion(row);
    if (!observacion) {
      return { ok: false, data: [], error: "Las observaciones devolvieron un contrato inesperado." };
    }
    observaciones.push(observacion);
  }
  return { ok: true, data: observaciones, error: null };
}

export async function crearObservacion(
  articuloId: string,
  texto: string,
): Promise<ResultadoEscritura> {
  if (!supabase) return { ok: false, error: "Supabase no está configurado." };
  const { error } = await supabase.rpc("crear_observacion", {
    p_articulo_id: articuloId,
    p_texto: texto,
  });
  if (error) {
    return {
      ok: false,
      error: /demasiado corta/i.test(error.message)
        ? "La observación es demasiado corta."
        : "No se pudo guardar la observación.",
    };
  }
  return { ok: true, error: null };
}

export async function atenderObservacion(
  observacionId: string,
  fundamento: string,
): Promise<ResultadoEscritura> {
  if (!supabase) return { ok: false, error: "Supabase no está configurado." };
  const { error } = await supabase.rpc("atender_observacion", {
    p_observacion_id: observacionId,
    p_fundamento: fundamento,
  });
  if (error) {
    return {
      ok: false,
      error: /Solo un administrador/i.test(error.message)
        ? "Solo un administrador marca una observación como atendida."
        : /fundamento/i.test(error.message)
          ? `El fundamento debe tener al menos ${MOTIVO_MIN_LENGTH} caracteres.`
          : "No se pudo atender la observación.",
    };
  }
  return { ok: true, error: null };
}

/** Todas las observaciones del proyecto, para exportarlas agrupadas. */
export async function loadObservacionesDelProyecto(
  proyectoId: string,
): Promise<LoadResult<Observacion[]>> {
  if (!supabase) return { ok: false, data: [], error: "Supabase no está configurado." };
  const { data: articulos, error: articulosError } = await supabase
    .from("norma_articulo")
    .select("id")
    .eq("proyecto_id", proyectoId);
  if (articulosError || !articulos) {
    return { ok: false, data: [], error: "No se pudo verificar el articulado." };
  }
  const ids = (articulos as { id: string }[]).map((fila) => fila.id);
  if (ids.length === 0) return { ok: true, data: [], error: null };

  const { data, error } = await supabase
    .from("norma_observacion")
    .select("id, articulo_id, texto, autor_nombre, autor_rol, creado_en, atendido_en, fundamento")
    .in("articulo_id", ids)
    .order("creado_en", { ascending: false });
  if (error || !data) {
    return { ok: false, data: [], error: "No se pudieron cargar las observaciones del proyecto." };
  }
  const observaciones: Observacion[] = [];
  for (const row of data as Record<string, unknown>[]) {
    const observacion = toObservacion(row);
    if (!observacion) {
      return { ok: false, data: [], error: "Las observaciones devolvieron un contrato inesperado." };
    }
    observaciones.push(observacion);
  }
  return { ok: true, data: observaciones, error: null };
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
