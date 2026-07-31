import { supabase } from "./supabase";
import {
  DEFAULT_EXPEDIENTE_STATE,
  isExpedienteState,
  type ExpedienteState,
} from "@/data/expedientes";
import type { AppRole } from "@/hooks/use-auth";
import {
  abandonEvidenceUpload,
  finalizeEvidence,
  reserveEvidenceUpload,
} from "./evidence-finalizer";

const DOC_BUCKET = "expediente-docs";
const SIGNED_URL_TTL_SECONDS = 3600;
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

export interface ExpedienteRecord {
  id: string;
  numero: string | null;
  cartelId: string;
  estado: ExpedienteState;
  empresa: string | null;
  direccion: string | null;
  observaciones: string | null;
  createdAt: string;
  updatedAt: string;
  cerradoEn: string | null;
}

export interface ExpedienteHistoryEntry {
  id: string;
  estadoAnterior: ExpedienteState | null;
  estadoNuevo: ExpedienteState;
  nota: string | null;
  changedByName: string | null;
  changedByRole: AppRole | null;
  createdAt: string;
}

export interface ExpedienteDocumento {
  id: string;
  descripcion: string | null;
  tipo: string | null;
  storagePath: string;
  sha256: string | null;
  byteSize: number | null;
  mimeType: string | null;
  uploadedBy: string | null;
  url: string | null;
  createdAt: string;
}

export interface ExpedienteDraft {
  cartelId: string;
  empresa: string | null;
  direccion: string | null;
  observaciones: string | null;
}

type ExpedienteRow = {
  id: string;
  numero: string | null;
  cartel_id: string;
  estado: string;
  empresa: string | null;
  direccion: string | null;
  observaciones: string | null;
  created_at: string;
  updated_at: string;
  cerrado_en: string | null;
};

function toState(value: string | null): ExpedienteState {
  return isExpedienteState(value) ? value : DEFAULT_EXPEDIENTE_STATE;
}

function fromRow(row: ExpedienteRow): ExpedienteRecord {
  return {
    id: row.id,
    numero: row.numero,
    cartelId: row.cartel_id,
    estado: toState(row.estado),
    empresa: row.empresa,
    direccion: row.direccion,
    observaciones: row.observaciones,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cerradoEn: row.cerrado_en,
  };
}

/** Todos los expedientes (para el registro/export). Requiere sesión (RLS). */
export async function loadExpedientes(): Promise<ExpedienteRecord[]> {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { data, error } = await supabase
    .from("expedientes")
    .select("*")
    .order("created_at", { ascending: false });
  if (error || !data) throw new Error("No se pudieron cargar los expedientes.");
  return (data as ExpedienteRow[]).map(fromRow);
}

/** Devuelve el expediente del cartel (1 por cartel) o null si no existe. */
export async function loadExpedienteByCartel(cartelId: string): Promise<ExpedienteRecord | null> {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { data, error } = await supabase
    .from("expedientes")
    .select("*")
    .eq("cartel_id", cartelId)
    .maybeSingle();
  if (error) throw new Error("No se pudo verificar el expediente del cartel.");
  if (!data) return null;
  return fromRow(data as ExpedienteRow);
}

/** Crea el expediente del cartel. Requiere rol administrador/coordinador (RLS). */
export async function createExpediente(draft: ExpedienteDraft): Promise<ExpedienteRecord | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("expedientes")
    .insert({
      cartel_id: draft.cartelId,
      empresa: draft.empresa,
      direccion: draft.direccion,
      observaciones: draft.observaciones,
    })
    .select("*")
    .single();
  if (error || !data) return null;
  return fromRow(data as ExpedienteRow);
}

/** Edita datos del expediente (empresa, dirección, observaciones). */
export async function updateExpediente(
  id: string,
  fields: { empresa?: string | null; direccion?: string | null; observaciones?: string | null },
): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from("expedientes")
    .update(fields)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  return !error && data?.id === id;
}

export async function loadExpedienteHistorial(expedienteId: string): Promise<ExpedienteHistoryEntry[]> {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { data, error } = await supabase
    .from("expediente_historial")
    .select("id, estado_anterior, estado_nuevo, nota, changed_by_nombre, changed_by_rol, created_at")
    .eq("expediente_id", expedienteId)
    .order("created_at", { ascending: true });
  if (error || !data) throw new Error("No se pudo cargar el historial del expediente.");
  return (data as { id: string; estado_anterior: string | null; estado_nuevo: string; nota: string | null; changed_by_nombre: string | null; changed_by_rol: AppRole | null; created_at: string }[]).map((row) => ({
    id: row.id,
    estadoAnterior: row.estado_anterior ? toState(row.estado_anterior) : null,
    estadoNuevo: toState(row.estado_nuevo),
    nota: row.nota,
    changedByName: row.changed_by_nombre,
    changedByRole: row.changed_by_rol,
    createdAt: row.created_at,
  }));
}

export async function loadExpedienteDocumentos(expedienteId: string): Promise<ExpedienteDocumento[]> {
  if (!supabase) throw new Error("Supabase no está configurado.");
  const { data, error } = await supabase
    .from("expediente_documentos")
    .select("id, descripcion, tipo, storage_path, sha256, byte_size, mime_type, created_by, created_at")
    .eq("expediente_id", expedienteId)
    .order("created_at", { ascending: false });
  if (error || !data) throw new Error("No se pudieron cargar los documentos del expediente.");
  const rows = data as {
    id: string;
    descripcion: string | null;
    tipo: string | null;
    storage_path: string;
    sha256: string | null;
    byte_size: number | null;
    mime_type: string | null;
    created_by: string | null;
    created_at: string;
  }[];
  if (rows.length === 0) return [];

  const { data: signed, error: signedError } = await supabase.storage
    .from(DOC_BUCKET)
    .createSignedUrls(rows.map((row) => row.storage_path), SIGNED_URL_TTL_SECONDS);
  if (
    signedError
    || !signed
    || signed.some((item) => !item.signedUrl)
  ) {
    throw new Error("No se pudieron autorizar las URLs de los documentos.");
  }
  const urlByPath = new Map((signed ?? []).map((item) => [item.path, item.signedUrl]));

  return rows.map((row) => ({
    id: row.id,
    descripcion: row.descripcion,
    tipo: row.tipo,
    storagePath: row.storage_path,
    sha256: row.sha256,
    byteSize: row.byte_size,
    mimeType: row.mime_type,
    uploadedBy: row.created_by,
    url: urlByPath.get(row.storage_path) ?? null,
    createdAt: row.created_at,
  }));
}

/** Sube un documento al expediente. Requiere rol administrador/coordinador. */
export async function uploadExpedienteDocumento(
  expedienteId: string,
  file: File,
  descripcion: string | null,
): Promise<boolean> {
  if (!supabase) return false;
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) return false;

  const mimeType = documentMimeType(file);
  if (!mimeType || file.size <= 0 || file.size > MAX_EVIDENCE_BYTES) return false;
  let sha256: string;
  try {
    sha256 = await fileSha256(file);
  } catch {
    return false;
  }
  const reservation = await reserveEvidenceUpload({
    kind: "expediente_documento",
    entityId: expedienteId,
    description: descripcion,
    sha256,
    byteSize: file.size,
    mimeType,
  });
  if (!reservation || reservation.bucketId !== DOC_BUCKET) return false;

  const { error: uploadError } = await supabase.storage
    .from(reservation.bucketId)
    .upload(reservation.storagePath, file, {
    upsert: false,
    contentType: mimeType,
    metadata: { sha256, ticket_id: reservation.ticketId },
  });
  if (uploadError) {
    await abandonEvidenceUpload(reservation.ticketId);
    return false;
  }
  return finalizeEvidence({
    accessToken: session.access_token,
    ticketId: reservation.ticketId,
  });
}

async function fileSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function documentMimeType(file: File): string | null {
  const provided = file.type.trim().toLowerCase();
  const canonicalProvided: Record<string, string> = {
    "application/pdf": "application/pdf",
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
    pdf: "application/pdf",
    png: "image/png",
    webp: "image/webp",
  };
  return extension ? byExtension[extension] ?? null : null;
}
