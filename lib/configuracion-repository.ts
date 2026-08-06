import type { LoadResult } from "@/data/approvals";
import { isAppRole, type AppRole } from "./roles";
import { supabase } from "./supabase";

// ----------------------------------------------------------------------------
// Bitácora unificada
// ----------------------------------------------------------------------------
export type TipoBitacora = "inspeccion" | "expediente" | "vinculo" | "rol" | "acceso";

export const TIPOS_BITACORA: { tipo: TipoBitacora; label: string }[] = [
  { tipo: "inspeccion", label: "Inspecciones" },
  { tipo: "expediente", label: "Expedientes" },
  { tipo: "vinculo", label: "Vínculos" },
  { tipo: "rol", label: "Cambios de rol" },
  { tipo: "acceso", label: "Accesos sensibles" },
];

export interface EntradaBitacora {
  tipo: TipoBitacora;
  ocurridoEn: string;
  actorNombre: string | null;
  actorRol: AppRole | null;
  accion: string;
  recurso: string;
  fundamento: string | null;
}

export interface PaginaBitacora {
  entradas: EntradaBitacora[];
  total: number;
}

export interface FiltrosBitacora {
  tipos: TipoBitacora[];
  desde: string | null;
  hasta: string | null;
  limite: number;
  offset: number;
}

function esTipo(value: unknown): value is TipoBitacora {
  return TIPOS_BITACORA.some((item) => item.tipo === value);
}

/**
 * Trae una página de la bitácora. El filtrado, el orden y el conteo total se
 * resuelven en PostgreSQL: son tablas que solo crecen y traerlas enteras al
 * navegador dejaría de funcionar el día que el sistema se use de verdad.
 */
export async function loadBitacora(
  filtros: FiltrosBitacora,
): Promise<LoadResult<PaginaBitacora>> {
  const vacio: PaginaBitacora = { entradas: [], total: 0 };
  if (!supabase) return { ok: false, data: vacio, error: "Supabase no está configurado." };

  const { data, error } = await supabase.rpc("bitacora_unificada", {
    p_tipos: filtros.tipos.length > 0 ? filtros.tipos : null,
    p_desde: filtros.desde,
    p_hasta: filtros.hasta,
    p_limite: filtros.limite,
    p_offset: filtros.offset,
  });
  if (error || !Array.isArray(data)) {
    return { ok: false, data: vacio, error: "No se pudo cargar la bitácora." };
  }

  const entradas: EntradaBitacora[] = [];
  let total = 0;
  for (const row of data as Record<string, unknown>[]) {
    if (!esTipo(row.tipo) || typeof row.ocurrido_en !== "string" || typeof row.accion !== "string") {
      return { ok: false, data: vacio, error: "La bitácora devolvió un contrato inesperado." };
    }
    total = typeof row.total_filas === "number"
      ? row.total_filas
      : Number(row.total_filas) || total;
    entradas.push({
      tipo: row.tipo,
      ocurridoEn: row.ocurrido_en,
      actorNombre: typeof row.actor_nombre === "string" ? row.actor_nombre : null,
      actorRol: isAppRole(row.actor_rol) ? row.actor_rol : null,
      accion: row.accion,
      recurso: typeof row.recurso === "string" ? row.recurso : "—",
      fundamento: typeof row.fundamento === "string" && row.fundamento.trim()
        ? row.fundamento
        : null,
    });
  }
  return { ok: true, data: { entradas, total }, error: null };
}

// ----------------------------------------------------------------------------
// Corpus documental
// ----------------------------------------------------------------------------
export interface DocumentoCorpus {
  id: string;
  titulo: string;
  categoria: string;
  paginas: number | null;
  chunks: number;
  audiencia: string;
  contratoVersion: number;
  revisadoPorHumano: boolean;
  iaExternaHabilitada: boolean;
  ocrDudoso: boolean;
  hashPdf: string | null;
  hashTexto: string | null;
}

export interface ResumenCorpus {
  documentos: number;
  chunks: number;
  contratoVersion: number | null;
  ultimaIngesta: string | null;
  habilitadosIaExterna: number;
  items: DocumentoCorpus[];
}

function toDocumento(value: unknown): DocumentoCorpus | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.titulo !== "string") return null;
  return {
    id: raw.id,
    titulo: raw.titulo,
    categoria: typeof raw.categoria === "string" ? raw.categoria : "—",
    paginas: typeof raw.paginas === "number" ? raw.paginas : null,
    chunks: typeof raw.chunks === "number" ? raw.chunks : 0,
    audiencia: typeof raw.audiencia === "string" ? raw.audiencia : "interno",
    contratoVersion: typeof raw.contrato_version === "number" ? raw.contrato_version : 0,
    revisadoPorHumano: raw.revisado_por_humano === true,
    iaExternaHabilitada: raw.ia_externa_habilitada === true,
    ocrDudoso: raw.ocr_dudoso === true,
    hashPdf: typeof raw.hash_pdf === "string" ? raw.hash_pdf : null,
    hashTexto: typeof raw.hash_texto === "string" ? raw.hash_texto : null,
  };
}

export async function loadResumenCorpus(): Promise<LoadResult<ResumenCorpus | null>> {
  if (!supabase) return { ok: false, data: null, error: "Supabase no está configurado." };
  const { data, error } = await supabase.rpc("resumen_corpus_rag");
  if (error || !data || typeof data !== "object") {
    return { ok: false, data: null, error: "No se pudo leer el estado del corpus." };
  }
  const raw = data as Record<string, unknown>;
  if (typeof raw.documentos !== "number" || !Array.isArray(raw.items)) {
    return { ok: false, data: null, error: "El corpus devolvió un contrato inesperado." };
  }
  const items: DocumentoCorpus[] = [];
  for (const item of raw.items) {
    const documento = toDocumento(item);
    if (!documento) {
      return { ok: false, data: null, error: "El corpus devolvió un contrato inesperado." };
    }
    items.push(documento);
  }
  return {
    ok: true,
    data: {
      documentos: raw.documentos,
      chunks: typeof raw.chunks === "number" ? raw.chunks : 0,
      contratoVersion: typeof raw.contrato_version === "number" ? raw.contrato_version : null,
      ultimaIngesta: typeof raw.ultima_ingesta === "string" ? raw.ultima_ingesta : null,
      habilitadosIaExterna: typeof raw.habilitados_ia_externa === "number"
        ? raw.habilitados_ia_externa
        : 0,
      items,
    },
    error: null,
  };
}

// ----------------------------------------------------------------------------
// Buckets de evidencia
// ----------------------------------------------------------------------------
export interface EstadoBucket {
  bucket: string;
  publico: boolean;
  limiteBytes: number | null;
  mimePermitidos: string[];
}

export async function loadEstadoBuckets(): Promise<LoadResult<EstadoBucket[]>> {
  if (!supabase) return { ok: false, data: [], error: "Supabase no está configurado." };
  const { data, error } = await supabase.rpc("estado_buckets_evidencia");
  if (error || !Array.isArray(data)) {
    return { ok: false, data: [], error: "No se pudo leer el estado de los buckets." };
  }
  const buckets: EstadoBucket[] = [];
  for (const row of data as Record<string, unknown>[]) {
    if (typeof row.bucket !== "string") {
      return { ok: false, data: [], error: "Los buckets devolvieron un contrato inesperado." };
    }
    buckets.push({
      bucket: row.bucket,
      publico: row.publico === true,
      limiteBytes: typeof row.limite_bytes === "number" ? row.limite_bytes : null,
      mimePermitidos: Array.isArray(row.mime_permitidos)
        ? row.mime_permitidos.filter((m): m is string => typeof m === "string")
        : [],
    });
  }
  return { ok: true, data: buckets, error: null };
}
