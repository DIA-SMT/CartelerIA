import { supabase } from "./supabase";
import {
  DEFAULT_INSPECTION_STATE,
  isInspectionState,
  type InspectionState,
} from "@/data/inspections";

const PHOTO_BUCKET = "inspeccion-fotos";

export interface InspectionRecord {
  id: string;
  cartelId: string;
  estado: InspectionState;
  tipoSoporte: string | null;
  anchoM: number | null;
  altoM: number | null;
  superficieM2: number | null;
  empresa: string | null;
  cuit: string | null;
  observaciones: string | null;
  programadaPara: string | null;
  inspeccionadaEn: string | null;
  createdAt: string;
}

export interface InspectionHistoryEntry {
  id: string;
  estadoAnterior: InspectionState | null;
  estadoNuevo: InspectionState;
  nota: string | null;
  createdAt: string;
}

export interface InspectionPhoto {
  id: string;
  storagePath: string;
  /** URL firmada temporal (bucket privado). null si no se pudo firmar. */
  url: string | null;
}

/** Datos que aporta el formulario para crear una inspección. */
export interface InspectionDraft {
  cartelId: string;
  estado: InspectionState;
  tipoSoporte: string | null;
  anchoM: number | null;
  altoM: number | null;
  empresa: string | null;
  cuit: string | null;
  observaciones: string | null;
  photos: File[];
}

export interface CreateInspectionResult {
  ok: boolean;
  inspectionId: string | null;
  /** Fotos que no pudieron subirse (p. ej. bucket no configurado). */
  photosFailed: number;
  error: string | null;
}

type InspectionRow = {
  id: string;
  cartel_id: string;
  estado: string;
  tipo_soporte: string | null;
  ancho_m: number | null;
  alto_m: number | null;
  superficie_m2: number | null;
  empresa: string | null;
  cuit: string | null;
  observaciones: string | null;
  programada_para: string | null;
  inspeccionada_en: string | null;
  created_at: string;
};

type HistoryRow = {
  id: string;
  estado_anterior: string | null;
  estado_nuevo: string;
  nota: string | null;
  created_at: string;
};

function toState(value: string | null): InspectionState {
  return isInspectionState(value) ? value : DEFAULT_INSPECTION_STATE;
}

function fromRow(row: InspectionRow): InspectionRecord {
  return {
    id: row.id,
    cartelId: row.cartel_id,
    estado: toState(row.estado),
    tipoSoporte: row.tipo_soporte,
    anchoM: row.ancho_m,
    altoM: row.alto_m,
    superficieM2: row.superficie_m2,
    empresa: row.empresa,
    cuit: row.cuit,
    observaciones: row.observaciones,
    programadaPara: row.programada_para,
    inspeccionadaEn: row.inspeccionada_en,
    createdAt: row.created_at,
  };
}

/**
 * Trae todas las inspecciones (para consultas agregadas de "Preguntale al mapa").
 * Requiere sesión: la RLS de `inspecciones` solo permite lectura autenticada.
 * Sin sesión o sin Supabase devuelve [].
 */
export async function loadInspections(): Promise<InspectionRecord[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("inspecciones")
    .select("*")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as InspectionRow[]).map(fromRow);
}

export async function loadInspectionsByCartel(cartelId: string): Promise<InspectionRecord[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("inspecciones")
    .select("*")
    .eq("cartel_id", cartelId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as InspectionRow[]).map(fromRow);
}

export async function loadInspectionHistory(inspectionId: string): Promise<InspectionHistoryEntry[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("inspeccion_historial")
    .select("id, estado_anterior, estado_nuevo, nota, created_at")
    .eq("inspeccion_id", inspectionId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as HistoryRow[]).map((row) => ({
    id: row.id,
    estadoAnterior: row.estado_anterior ? toState(row.estado_anterior) : null,
    estadoNuevo: toState(row.estado_nuevo),
    nota: row.nota,
    createdAt: row.created_at,
  }));
}

const SIGNED_URL_TTL_SECONDS = 3600;

export async function loadInspectionPhotos(inspectionId: string): Promise<InspectionPhoto[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("inspeccion_fotos")
    .select("id, storage_path")
    .eq("inspeccion_id", inspectionId)
    .order("orden", { ascending: true });
  if (error || !data) return [];
  const rows = data as { id: string; storage_path: string }[];
  if (rows.length === 0) return [];

  const { data: signed } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(rows.map((row) => row.storage_path), SIGNED_URL_TTL_SECONDS);
  const urlByPath = new Map((signed ?? []).map((item) => [item.path, item.signedUrl]));

  return rows.map((row) => ({
    id: row.id,
    storagePath: row.storage_path,
    url: urlByPath.get(row.storage_path) ?? null,
  }));
}

/** Campos editables de una inspección (el estado se cambia por transiciones). */
export interface InspectionEditableFields {
  tipoSoporte: string | null;
  anchoM: number | null;
  altoM: number | null;
  empresa: string | null;
  cuit: string | null;
  observaciones: string | null;
}

/**
 * Edita los datos de una inspección existente. No toca el estado (eso va por
 * transiciones para preservar el historial). Requiere rol operativo (RLS).
 */
export async function updateInspection(
  inspectionId: string,
  fields: InspectionEditableFields,
): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase
    .from("inspecciones")
    .update({
      tipo_soporte: fields.tipoSoporte,
      ancho_m: fields.anchoM,
      alto_m: fields.altoM,
      empresa: fields.empresa,
      cuit: fields.cuit,
      observaciones: fields.observaciones,
    })
    .eq("id", inspectionId);
  return !error;
}

/**
 * Elimina una inspección. Primero borra la fila verificando que la RLS lo haya
 * permitido de verdad (sin policy de DELETE, Postgres "borra" 0 filas sin
 * error), y recién entonces limpia los archivos del bucket. Las filas de fotos
 * e historial caen por cascade. Requiere la policy de la migración 09.
 */
export async function deleteInspection(inspectionId: string): Promise<boolean> {
  if (!supabase) return false;
  // Listar los archivos ANTES de borrar (después no queda registro de los paths).
  const { data: files } = await supabase.storage.from(PHOTO_BUCKET).list(inspectionId);

  const { data, error } = await supabase
    .from("inspecciones")
    .delete()
    .eq("id", inspectionId)
    .select("id");
  if (error || !data || data.length === 0) return false;

  if (files && files.length > 0) {
    await supabase.storage.from(PHOTO_BUCKET).remove(files.map((file) => `${inspectionId}/${file.name}`));
  }
  return true;
}

/** Elimina una foto puntual (archivo del bucket + fila). Requiere rol operativo. */
export async function deleteInspectionPhoto(photo: InspectionPhoto): Promise<boolean> {
  if (!supabase) return false;
  await supabase.storage.from(PHOTO_BUCKET).remove([photo.storagePath]);
  const { error } = await supabase.from("inspeccion_fotos").delete().eq("id", photo.id);
  return !error;
}

/**
 * Cambia el estado de una inspección. El historial lo registra el trigger de
 * la base automáticamente. Requiere sesión con rol operativo (lo impone la RLS).
 * La validación de transición permitida (canTransition) se hace en la UI.
 */
export async function updateInspectionState(
  inspectionId: string,
  estado: InspectionState,
): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase
    .from("inspecciones")
    .update({ estado })
    .eq("id", inspectionId);
  return !error;
}

/**
 * Sube fotos a una inspección (alta o edición). Devuelve cuántas fallaron.
 * Requiere rol operativo (RLS de storage + tabla).
 */
export async function addInspectionPhotos(inspectionId: string, photos: File[]): Promise<number> {
  if (!supabase || photos.length === 0) return 0;
  let failed = 0;
  for (let index = 0; index < photos.length; index += 1) {
    const photo = photos[index];
    const safeName = photo.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${inspectionId}/${Date.now()}_${index}_${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, photo, { upsert: false });
    if (uploadError) {
      failed += 1;
      continue;
    }
    const { error: rowError } = await supabase.from("inspeccion_fotos").insert({
      inspeccion_id: inspectionId,
      storage_path: path,
      orden: index,
    });
    if (rowError) failed += 1;
  }
  return failed;
}

/**
 * Crea una inspección y sube las fotos asociadas.
 * Requiere sesión autenticada con rol operativo (lo impone la RLS de Supabase).
 * La superficie se calcula en la base (columna generada), no se envía.
 */
export async function createInspection(draft: InspectionDraft): Promise<CreateInspectionResult> {
  if (!supabase) {
    return { ok: false, inspectionId: null, photosFailed: 0, error: "Supabase no está configurado." };
  }

  const { data, error } = await supabase
    .from("inspecciones")
    .insert({
      cartel_id: draft.cartelId,
      estado: draft.estado,
      tipo_soporte: draft.tipoSoporte,
      ancho_m: draft.anchoM,
      alto_m: draft.altoM,
      empresa: draft.empresa,
      cuit: draft.cuit,
      observaciones: draft.observaciones,
    })
    .select("id")
    .single();

  if (error || !data) {
    return {
      ok: false,
      inspectionId: null,
      photosFailed: 0,
      error: "No se pudo guardar la inspección. Verificá tu sesión y permisos.",
    };
  }

  const photosFailed = await addInspectionPhotos(data.id as string, draft.photos);
  return { ok: true, inspectionId: data.id as string, photosFailed, error: null };
}
