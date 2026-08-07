import type { LoadResult } from "@/data/approvals";
import { esClaveParametro, type ClaveParametro } from "./norma-simulador";
import { isAppRole, type AppRole } from "./roles";
import { supabase } from "./supabase";

/**
 * `estado` sobrevive como mecanismo, no como etiqueta que alguien lea: la
 * pantalla solo usa `descartado` para sacar un artículo del documento y
 * `propuesto` para volver a incluirlo. Los otros dos valores quedan en la
 * columna por compatibilidad con lo ya cargado.
 */
export type EstadoArticulo = "propuesto" | "en_revision" | "aprobado" | "descartado";
export type OrigenArticulo = "borrador_recibido" | "redactado" | "asistente";

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
  { match: /exige un rol operativo/i, message: "Tu rol no permite escribir el articulado." },
  { match: /demasiado corto/i, message: "El texto del artículo es demasiado corto." },
  // Estos dos solo aparecen si falta correr la migración 29, que es la que
  // saca los fundamentos obligatorios.
  { match: /motivo del cambio es obligatorio/i, message: "Falta aplicar la migración 29 en el SQL Editor." },
  { match: /fundamento de al menos/i, message: "Falta aplicar la migración 29 en el SQL Editor." },
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

/**
 * Crea un artículo.
 *
 * `motivo` es de dónde sale el artículo dicho por la persona. Cuando el texto
 * lo propuso el asistente, acá va la idea en lenguaje llano que se le dio: es
 * lo único que después permite distinguir qué pidió una persona de qué escribió
 * la máquina.
 *
 * Devuelve el id para poder abrir el artículo recién creado sin buscarlo.
 */
export async function crearArticulo(input: {
  proyectoId: string;
  texto: string;
  sumilla: string | null;
  origen: "redactado" | "asistente";
  motivo: string;
}): Promise<ResultadoEscritura & { articuloId: string | null }> {
  if (!supabase) return { ok: false, error: "Supabase no está configurado.", articuloId: null };
  const { data, error } = await supabase.rpc("crear_articulo", {
    p_proyecto_id: input.proyectoId,
    p_texto: input.texto,
    p_sumilla: input.sumilla,
    p_origen: input.origen,
    p_motivo: input.motivo,
  });
  if (error) {
    // PostgREST devuelve PGRST202 tanto si la función no existe como si la
    // firma no coincide. Para esta RPC, que acaba de cambiar de firma, lo
    // segundo significa una sola cosa concreta y conviene decirla.
    const faltaMigracion = error.code === "PGRST202";
    return {
      ok: false,
      error: faltaMigracion
        ? "Falta aplicar la migración 25 en el SQL Editor."
        : traducir(error.message, "No se pudo crear el artículo."),
      articuloId: null,
    };
  }
  return { ok: true, error: null, articuloId: typeof data === "string" ? data : null };
}

export interface PropuestaArticulo {
  ok: boolean;
  /** false cuando la IA externa no intervino: hay que redactar a mano. */
  asistido: boolean;
  motivo: string | null;
  /** false cuando el asistente pide definiciones en vez de rellenar. */
  suficiente: boolean;
  falta: string | null;
  sumilla: string | null;
  texto: string;
  error: string | null;
}

/** Por qué el asistente no intervino, en castellano. */
export const MOTIVO_ASISTENTE: Record<string, string> = {
  asistencia_deshabilitada: "La asistencia por IA externa está deshabilitada en este entorno.",
  pii_detectada: "El texto contiene identificadores personales, así que no se envía a un servicio externo.",
};

/**
 * Convierte una idea en lenguaje llano en un artículo con forma jurídica.
 *
 * El asistente PROPONE: la respuesta vuelve al navegador y no toca la base. El
 * artículo lo crea una persona al aceptarlo, y puede editarlo antes.
 *
 * Que devuelva `suficiente: false` no es una falla: es el asistente pidiendo
 * las definiciones que le faltan en vez de inventar un plazo o una medida. Un
 * artículo verosímil con un vacío adentro es peor que ninguno.
 */
export async function proponerArticulo(idea: string): Promise<PropuestaArticulo> {
  const vacio = {
    ok: false, asistido: false, motivo: null, suficiente: false,
    falta: null, sumilla: null, texto: "", error: "",
  };
  if (!supabase) return { ...vacio, error: "Supabase no está configurado." };
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { ...vacio, error: "Tu sesión no está vigente." };

  let respuesta: Response;
  try {
    respuesta = await fetch("/api/fabrica", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "proponer_articulo", idea }),
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
    return {
      ...vacio,
      error: respuesta.status === 429
        ? "Alcanzaste el límite de consultas al asistente. Probá en un rato."
        : "El asistente no pudo redactar la propuesta.",
    };
  }

  return {
    ok: true,
    asistido: payload.asistido === true,
    motivo: typeof payload.motivo === "string" ? payload.motivo : null,
    suficiente: payload.suficiente === true,
    falta: typeof payload.falta === "string" ? payload.falta : null,
    sumilla: typeof payload.sumilla === "string" ? payload.sumilla : null,
    texto: typeof payload.texto === "string" ? payload.texto : "",
    error: null,
  };
}
