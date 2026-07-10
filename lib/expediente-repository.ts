import { supabase } from "./supabase";
import {
  DEFAULT_EXPEDIENTE_STATE,
  isExpedienteState,
  type ExpedienteState,
} from "@/data/expedientes";

const DOC_BUCKET = "expediente-docs";
const SIGNED_URL_TTL_SECONDS = 3600;

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
  createdAt: string;
}

export interface ExpedienteDocumento {
  id: string;
  descripcion: string | null;
  tipo: string | null;
  storagePath: string;
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
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("expedientes")
    .select("*")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as ExpedienteRow[]).map(fromRow);
}

/** Devuelve el expediente del cartel (1 por cartel) o null si no existe. */
export async function loadExpedienteByCartel(cartelId: string): Promise<ExpedienteRecord | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("expedientes")
    .select("*")
    .eq("cartel_id", cartelId)
    .maybeSingle();
  if (error || !data) return null;
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

/** Cambia el estado. El historial lo registra el trigger de la base. */
export async function updateExpedienteEstado(id: string, estado: ExpedienteState): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("expedientes").update({ estado }).eq("id", id);
  return !error;
}

/** Edita datos del expediente (empresa, dirección, observaciones). */
export async function updateExpediente(
  id: string,
  fields: { empresa?: string | null; direccion?: string | null; observaciones?: string | null },
): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("expedientes").update(fields).eq("id", id);
  return !error;
}

export async function loadExpedienteHistorial(expedienteId: string): Promise<ExpedienteHistoryEntry[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("expediente_historial")
    .select("id, estado_anterior, estado_nuevo, nota, created_at")
    .eq("expediente_id", expedienteId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as { id: string; estado_anterior: string | null; estado_nuevo: string; nota: string | null; created_at: string }[]).map((row) => ({
    id: row.id,
    estadoAnterior: row.estado_anterior ? toState(row.estado_anterior) : null,
    estadoNuevo: toState(row.estado_nuevo),
    nota: row.nota,
    createdAt: row.created_at,
  }));
}

export async function loadExpedienteDocumentos(expedienteId: string): Promise<ExpedienteDocumento[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("expediente_documentos")
    .select("id, descripcion, tipo, storage_path, created_at")
    .eq("expediente_id", expedienteId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  const rows = data as { id: string; descripcion: string | null; tipo: string | null; storage_path: string; created_at: string }[];
  if (rows.length === 0) return [];

  const { data: signed } = await supabase.storage
    .from(DOC_BUCKET)
    .createSignedUrls(rows.map((row) => row.storage_path), SIGNED_URL_TTL_SECONDS);
  const urlByPath = new Map((signed ?? []).map((item) => [item.path, item.signedUrl]));

  return rows.map((row) => ({
    id: row.id,
    descripcion: row.descripcion,
    tipo: row.tipo,
    storagePath: row.storage_path,
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
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${expedienteId}/${Date.now()}_${safeName}`;
  const { error: uploadError } = await supabase.storage.from(DOC_BUCKET).upload(path, file, { upsert: false });
  if (uploadError) return false;
  const { error: rowError } = await supabase.from("expediente_documentos").insert({
    expediente_id: expedienteId,
    storage_path: path,
    descripcion,
    tipo: file.type || null,
  });
  return !rowError;
}
