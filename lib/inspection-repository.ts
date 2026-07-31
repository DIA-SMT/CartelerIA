import { supabase } from "./supabase";
import {
  DEFAULT_INSPECTION_STATE,
  isInspectionState,
  type InspectionState,
} from "@/data/inspections";
import type { AppRole } from "@/hooks/use-auth";
import {
  abandonEvidenceUpload,
  finalizeEvidence,
  reserveEvidenceUpload,
} from "./evidence-finalizer";

const PHOTO_BUCKET = "inspeccion-fotos";
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

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
  changedByName: string | null;
  changedByRole: AppRole | null;
  createdAt: string;
}

export interface InspectionPhoto {
  id: string;
  storagePath: string;
  sha256: string | null;
  byteSize: number | null;
  mimeType: string | null;
  uploadedBy: string | null;
  /** URL firmada temporal (bucket privado). null si no se pudo firmar. */
  url: string | null;
}

/** Datos que aporta el formulario para crear una inspección. */
export interface InspectionDraft {
  cartelId: string;
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
  changed_by_nombre: string | null;
  changed_by_rol: AppRole | null;
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
 * Falla de forma explícita: una caída de la fuente no debe presentarse como
 * "sin inspecciones".
 */
export async function loadInspections(): Promise<InspectionRecord[]> {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { data, error } = await supabase
    .from("inspecciones")
    .select("*")
    .order("created_at", { ascending: false });
  if (error || !data) throw new Error("No se pudieron cargar las inspecciones.");
  return (data as InspectionRow[]).map(fromRow);
}

export async function loadInspectionsByCartel(cartelId: string): Promise<InspectionRecord[]> {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { data, error } = await supabase
    .from("inspecciones")
    .select("*")
    .eq("cartel_id", cartelId)
    .order("created_at", { ascending: false });
  if (error || !data) throw new Error("No se pudieron cargar las inspecciones.");
  return (data as InspectionRow[]).map(fromRow);
}

export async function loadInspectionHistory(inspectionId: string): Promise<InspectionHistoryEntry[]> {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { data, error } = await supabase
    .from("inspeccion_historial")
    .select("id, estado_anterior, estado_nuevo, nota, changed_by_nombre, changed_by_rol, created_at")
    .eq("inspeccion_id", inspectionId)
    .order("created_at", { ascending: true });
  if (error || !data) throw new Error("No se pudo cargar el historial de la inspección.");
  return (data as HistoryRow[]).map((row) => ({
    id: row.id,
    estadoAnterior: row.estado_anterior ? toState(row.estado_anterior) : null,
    estadoNuevo: toState(row.estado_nuevo),
    nota: row.nota,
    changedByName: row.changed_by_nombre,
    changedByRole: row.changed_by_rol,
    createdAt: row.created_at,
  }));
}

const SIGNED_URL_TTL_SECONDS = 3600;

export async function loadInspectionPhotos(inspectionId: string): Promise<InspectionPhoto[]> {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { data, error } = await supabase
    .from("inspeccion_fotos")
    .select("id, storage_path, sha256, byte_size, mime_type, created_by")
    .eq("inspeccion_id", inspectionId)
    .order("orden", { ascending: true });
  if (error || !data) throw new Error("No se pudo cargar la evidencia fotográfica.");
  const rows = data as {
    id: string;
    storage_path: string;
    sha256: string | null;
    byte_size: number | null;
    mime_type: string | null;
    created_by: string | null;
  }[];
  if (rows.length === 0) return [];

  const { data: signed, error: signedError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(rows.map((row) => row.storage_path), SIGNED_URL_TTL_SECONDS);
  if (
    signedError
    || !signed
    || signed.some((item) => !item.signedUrl)
  ) {
    throw new Error("No se pudieron autorizar las URLs de la evidencia.");
  }
  const urlByPath = new Map((signed ?? []).map((item) => [item.path, item.signedUrl]));

  return rows.map((row) => ({
    id: row.id,
    storagePath: row.storage_path,
    sha256: row.sha256,
    byteSize: row.byte_size,
    mimeType: row.mime_type,
    uploadedBy: row.created_by,
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
  const { data, error } = await supabase
    .from("inspecciones")
    .update({
      tipo_soporte: fields.tipoSoporte,
      ancho_m: fields.anchoM,
      alto_m: fields.altoM,
      empresa: fields.empresa,
      cuit: fields.cuit,
      observaciones: fields.observaciones,
    })
    .eq("id", inspectionId)
    .select("id")
    .maybeSingle();
  return !error && data?.id === inspectionId;
}

/**
 * Sube fotos a una inspección (alta o edición). Devuelve cuántas fallaron.
 * Requiere rol operativo (RLS de storage + tabla).
 */
export async function addInspectionPhotos(inspectionId: string, photos: File[]): Promise<number> {
  if (photos.length === 0) return 0;
  if (!supabase) return photos.length;
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) return photos.length;

  let failed = 0;
  for (let index = 0; index < photos.length; index += 1) {
    const photo = photos[index];
    const mimeType = imageMimeType(photo);
    if (!mimeType || photo.size <= 0 || photo.size > MAX_EVIDENCE_BYTES) {
      failed += 1;
      continue;
    }
    let sha256: string;
    try {
      sha256 = await fileSha256(photo);
    } catch {
      failed += 1;
      continue;
    }
    const reservation = await reserveEvidenceUpload({
      kind: "inspeccion_foto",
      entityId: inspectionId,
      description: photo.name.slice(0, 500) || null,
      sha256,
      byteSize: photo.size,
      mimeType,
    });
    if (!reservation || reservation.bucketId !== PHOTO_BUCKET) {
      failed += 1;
      continue;
    }
    const { error: uploadError } = await supabase.storage
      .from(reservation.bucketId)
      .upload(reservation.storagePath, photo, {
        upsert: false,
        contentType: mimeType,
        metadata: { sha256, ticket_id: reservation.ticketId },
      });
    if (uploadError) {
      await abandonEvidenceUpload(reservation.ticketId);
      failed += 1;
      continue;
    }
    const finalized = await finalizeEvidence({
      accessToken: session.access_token,
      ticketId: reservation.ticketId,
    });
    if (!finalized) failed += 1;
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
      estado: DEFAULT_INSPECTION_STATE,
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

async function fileSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function imageMimeType(file: File): string | null {
  const provided = file.type.trim().toLowerCase();
  const canonicalProvided: Record<string, string> = {
    "image/gif": "image/gif",
    "image/heic": "image/heic",
    "image/heif": "image/heic",
    "image/jpeg": "image/jpeg",
    "image/jpg": "image/jpeg",
    "image/png": "image/png",
    "image/webp": "image/webp",
  };
  if (provided && canonicalProvided[provided]) return canonicalProvided[provided];
  const extension = file.name.split(".").pop()?.toLowerCase();
  const byExtension: Record<string, string> = {
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heic",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  return extension ? byExtension[extension] ?? null : null;
}
