import type { CartelRecord } from "@/data/carteles";
import { initialCarteles } from "@/data/carteles";
import { supabase } from "./supabase";

type CartelRow = {
  id: string; empresa: string; cuit: string; tipo_cartel: string; dimensiones: string;
  superficie_m2: number | null; domicilio: string; numero: string; google_maps_url: string;
  padron_cisi: string; estado: CartelRecord["estado"]; latitud: number | null; longitud: number | null;
  location_source: CartelRecord["locationSource"]; status: CartelRecord["status"];
  contamination_level: CartelRecord["contaminationLevel"]; zone: string;
  street_view_image_url: string | null; original_latitud: number | null; original_longitud: number | null;
  location_edited: boolean;
};

function fromRow(row: CartelRow): CartelRecord {
  return {
    id: row.id, empresa: row.empresa, cuit: row.cuit, tipoCartel: row.tipo_cartel,
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
