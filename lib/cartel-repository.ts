import type { CartelRecord } from "@/data/carteles";
import { initialCarteles } from "@/data/carteles";
import { supabase } from "./supabase";

type CartelRow = {
  id: string; territorial_feature_id?: string | null; empresa: string; cuit: string; tipo_cartel: string; dimensiones: string;
  superficie_m2: number | null; domicilio: string; numero: string; google_maps_url: string;
  padron_cisi: string; estado: CartelRecord["estado"]; latitud: number | null; longitud: number | null;
  location_source: CartelRecord["locationSource"]; status: CartelRecord["status"];
  contamination_level: CartelRecord["contaminationLevel"]; zone: string;
  street_view_image_url: string | null; original_latitud: number | null; original_longitud: number | null;
  location_edited: boolean;
};

function fromRow(row: CartelRow): CartelRecord {
  return {
    id: row.id, territorialFeatureId: row.territorial_feature_id ?? null, empresa: row.empresa, cuit: row.cuit, tipoCartel: row.tipo_cartel,
    dimensiones: row.dimensiones, superficieM2: row.superficie_m2, domicilio: row.domicilio,
    numero: row.numero, googleMapsUrl: row.google_maps_url, padronCisi: row.padron_cisi,
    estado: row.estado, latitud: row.latitud, longitud: row.longitud, locationSource: row.location_source,
    status: row.status, contaminationLevel: row.contamination_level, zone: row.zone,
    streetViewImageUrl: row.street_view_image_url, originalLatitud: row.original_latitud,
    originalLongitud: row.original_longitud, locationEdited: row.location_edited
  };
}

export async function loadCarteles(): Promise<{ data: CartelRecord[]; source: "supabase" | "static" }> {
  if (!supabase) return { data: initialCarteles, source: "static" };
  const { data, error } = await supabase.from("carteles").select("*").order("id");
  if (error || !data?.length) {
    if (error) console.warn("Supabase no disponible; se usan datos estáticos:", error.message);
    return { data: initialCarteles, source: "static" };
  }
  return { data: (data as CartelRow[]).map(fromRow), source: "supabase" };
}

/** Datos del alta de un cartel desde la UI (todos los campos de texto son opcionales). */
export interface RegisterCartelDraft {
  territorialFeatureId: string;
  latitud: number | null;
  longitud: number | null;
  empresa: string | null;
  cuit: string | null;
  domicilio: string | null;
  numero: string | null;
}

export interface RegisterCartelResult {
  ok: boolean;
  recordId: string | null;
  /** true si el cartel ya estaba registrado (se devuelve el vínculo existente). */
  alreadyExisted: boolean;
  error: string | null;
}

/**
 * Registra un cartel del mapa en el registro administrativo, vinculado por
 * territorial_feature_id. Requiere sesión con rol operativo (lo impone la RLS,
 * migración 08). Si ya existía (índice único), devuelve el registro existente.
 */
export async function registerCartel(draft: RegisterCartelDraft): Promise<RegisterCartelResult> {
  if (!supabase) return { ok: false, recordId: null, alreadyExisted: false, error: "Supabase no está configurado." };

  const { data, error } = await supabase
    .from("carteles")
    .insert({
      id: `reg-${draft.territorialFeatureId}`,
      territorial_feature_id: draft.territorialFeatureId,
      empresa: draft.empresa ?? "",
      cuit: draft.cuit ?? "",
      domicilio: draft.domicilio ?? "",
      numero: draft.numero ?? "",
      latitud: draft.latitud,
      longitud: draft.longitud,
      estado: "Relevado",
      status: "relevado",
    })
    .select("id")
    .single();

  if (!error && data) return { ok: true, recordId: data.id as string, alreadyExisted: false, error: null };

  // Duplicado (23505): otro usuario lo registró — recuperar el vínculo existente.
  if (error?.code === "23505") {
    const { data: existing } = await supabase
      .from("carteles")
      .select("id")
      .eq("territorial_feature_id", draft.territorialFeatureId)
      .maybeSingle();
    if (existing) return { ok: true, recordId: existing.id as string, alreadyExisted: true, error: null };
  }

  return {
    ok: false,
    recordId: null,
    alreadyExisted: false,
    error: "No se pudo registrar el cartel. Verificá tu sesión y permisos.",
  };
}

export async function saveCartelLocation(cartel: CartelRecord) {
  if (!supabase) return false;
  const { error } = await supabase.from("carteles").update({
    domicilio: cartel.domicilio,
    numero: cartel.numero,
    latitud: cartel.latitud,
    longitud: cartel.longitud,
    location_source: cartel.locationSource,
    location_edited: cartel.locationEdited,
    updated_at: new Date().toISOString()
  }).eq("id", cartel.id);
  if (error) console.warn("No se pudo guardar la corrección en Supabase:", error.message);
  return !error;
}
