import type { CartelRecord, TerritorialLinkStatus } from "@/data/carteles";
import type { LoadResult } from "@/data/approvals";
import { supabase } from "./supabase";

type CartelRow = {
  id: string; territorial_feature_id?: string | null; territorial_feature_id_propuesto?: string | null;
  vinculo_estado?: TerritorialLinkStatus; empresa: string; cuit: string; tipo_cartel: string; dimensiones: string;
  superficie_m2: number | null; domicilio: string; numero: string; google_maps_url: string;
  padron_cisi: string; estado: CartelRecord["estado"]; latitud: number | null; longitud: number | null;
  location_source: CartelRecord["locationSource"]; status: CartelRecord["status"];
  contamination_level: CartelRecord["contaminationLevel"]; zone: string;
  street_view_image_url: string | null; original_latitud: number | null; original_longitud: number | null;
  location_edited: boolean;
};

function verifiedLink(row: CartelRow): {
  status: TerritorialLinkStatus;
  activeFeatureId: string | null;
  proposedFeatureId: string | null;
} {
  const active = row.territorial_feature_id?.trim() || null;
  const proposed = row.territorial_feature_id_propuesto?.trim() || null;
  if (row.vinculo_estado === "aprobado" && active && !proposed) {
    return { status: "aprobado", activeFeatureId: active, proposedFeatureId: null };
  }
  if (
    (row.vinculo_estado === "pendiente" || row.vinculo_estado === "rechazado")
    && !active
    && proposed
  ) {
    return {
      status: row.vinculo_estado,
      activeFeatureId: null,
      proposedFeatureId: proposed,
    };
  }
  return { status: "sin_vinculo", activeFeatureId: null, proposedFeatureId: null };
}

function fromRow(row: CartelRow): CartelRecord {
  const link = verifiedLink(row);
  return {
    id: row.id, territorialFeatureId: link.activeFeatureId,
    proposedTerritorialFeatureId: link.proposedFeatureId,
    territorialLinkStatus: link.status,
    empresa: row.empresa, cuit: row.cuit, tipoCartel: row.tipo_cartel,
    dimensiones: row.dimensiones, superficieM2: row.superficie_m2, domicilio: row.domicilio,
    numero: row.numero, googleMapsUrl: row.google_maps_url, padronCisi: row.padron_cisi,
    estado: row.estado, latitud: row.latitud, longitud: row.longitud, locationSource: row.location_source,
    status: row.status, contaminationLevel: row.contamination_level, zone: row.zone,
    streetViewImageUrl: row.street_view_image_url, originalLatitud: row.original_latitud,
    originalLongitud: row.original_longitud, locationEdited: row.location_edited
  };
}

export type AdministrativeCartelSource = "supabase" | "unavailable";

/**
 * Carga el registro administrativo exclusivamente desde Supabase.
 *
 * No existe fallback al JSON local: además de ocultar una caída, importarlo en
 * un módulo cliente incorporaba empresas, CUIT y padrones al bundle público.
 * El llamador solo debe ejecutar esta consulta con una sesión autenticada.
 */
export async function loadCarteles(): Promise<{ data: CartelRecord[]; source: AdministrativeCartelSource }> {
  if (!supabase) return { data: [], source: "unavailable" };
  const { data, error } = await supabase.from("carteles").select("*").order("id");
  if (error || !data) {
    if (error) console.warn("Registro administrativo no disponible:", error.message);
    return { data: [], source: "unavailable" };
  }
  return { data: (data as CartelRow[]).map(fromRow), source: "supabase" };
}

/** Datos del alta de un cartel desde la UI (todos los campos de texto son opcionales). */
export interface RegisterCartelDraft {
  territorialFeatureId: string;
  linkReason: string;
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
  linkStatus: TerritorialLinkStatus | null;
  error: string | null;
}

/**
 * Crea (o recupera) el registro y solicita su vínculo en una sola transacción.
 * La RPC valida la asociación, conserva el fundamento y evita altas parciales.
 */
export async function registerCartel(draft: RegisterCartelDraft): Promise<RegisterCartelResult> {
  if (!supabase) return { ok: false, recordId: null, alreadyExisted: false, linkStatus: null, error: "Supabase no está configurado." };

  const { data, error } = await supabase
    .rpc("registrar_cartel_y_solicitar_vinculo", {
      p_territorial_feature_id: draft.territorialFeatureId,
      p_fundamento: draft.linkReason.trim(),
      p_latitud: draft.latitud,
      p_longitud: draft.longitud,
      p_empresa: draft.empresa,
      p_cuit: draft.cuit,
      p_domicilio: draft.domicilio,
      p_numero: draft.numero,
    })
    .single();

  const row = data as {
    record_id?: unknown;
    already_existed?: unknown;
    link_status?: unknown;
  } | null;
  if (
    !error
    && typeof row?.record_id === "string"
    && typeof row.already_existed === "boolean"
    && (
      row.link_status === "sin_vinculo"
      || row.link_status === "pendiente"
      || row.link_status === "aprobado"
      || row.link_status === "rechazado"
    )
  ) {
    return {
      ok: true,
      recordId: row.record_id,
      alreadyExisted: row.already_existed,
      linkStatus: row.link_status,
      error: null,
    };
  }

  return {
    ok: false,
    recordId: null,
    alreadyExisted: false,
    linkStatus: null,
    error: "No se pudo registrar el cartel. Verificá tu sesión y permisos.",
  };
}

export async function requestCartelTerritorialLink(
  cartelId: string,
  territorialFeatureId: string,
  reason: string,
): Promise<boolean> {
  if (!supabase || reason.trim().length < 5) return false;
  const { data, error } = await supabase.rpc("solicitar_vinculo_cartel", {
    p_cartel_id: cartelId,
    p_territorial_feature_id: territorialFeatureId,
    p_fundamento: reason.trim(),
  });
  return !error && data === true;
}

export async function resolveCartelTerritorialLink(
  cartelId: string,
  approve: boolean,
  reason: string,
): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("resolver_vinculo_cartel", {
    p_cartel_id: cartelId,
    p_aprobar: approve,
    p_fundamento: reason,
  });
  return !error && data === true;
}

export interface PendingCartelLink {
  cartelId: string;
  territorialFeatureId: string;
  empresa: string;
  direccion: string;
  reason: string;
  requesterName: string | null;
  requesterRole: string | null;
  requestedAt: string | null;
}

export async function loadPendingCartelLinks(): Promise<LoadResult<PendingCartelLink[]>> {
  if (!supabase) {
    return { ok: false, data: [], error: "Supabase no está configurado." };
  }
  const { data, error } = await supabase
    .from("carteles")
    .select(
      "id, territorial_feature_id_propuesto, empresa, domicilio, numero, vinculo_solicitado_en",
    )
    .eq("vinculo_estado", "pendiente")
    .order("vinculo_solicitado_en", { ascending: true });
  if (error || !data) {
    return {
      ok: false,
      data: [],
      error: "No se pudieron cargar los vínculos territoriales pendientes.",
    };
  }
  let invalidReference = false;
  const links: PendingCartelLink[] = (data as {
    id: string;
    territorial_feature_id_propuesto: string | null;
    empresa: string;
    domicilio: string;
    numero: string;
    vinculo_solicitado_en: string | null;
  }[]).map((row) => ({
    cartelId: row.id,
    territorialFeatureId: row.territorial_feature_id_propuesto ?? "Sin identificador",
    empresa: row.empresa,
    direccion: [row.domicilio, row.numero].filter(Boolean).join(" "),
    reason: "",
    requesterName: null,
    requesterRole: null,
    requestedAt: row.vinculo_solicitado_en,
  }));
  invalidReference = (data as { territorial_feature_id_propuesto: string | null }[])
    .some((row) => !row.territorial_feature_id_propuesto);

  if (links.length > 0) {
    const { data: historyData, error: historyError } = await supabase
      .from("cartel_vinculo_historial")
      .select(
        "cartel_id, territorial_feature_id, fundamento, actor_nombre, actor_rol, created_at",
      )
      .in("cartel_id", links.map((link) => link.cartelId))
      .eq("accion", "solicitado")
      .order("created_at", { ascending: false });
    if (historyError || !historyData) {
      return {
        ok: false,
        data: [],
        error: "No se pudo verificar el fundamento de los vínculos pendientes.",
      };
    }

    type LinkHistoryRow = {
      cartel_id: string;
      territorial_feature_id: string;
      fundamento: string | null;
      actor_nombre: string | null;
      actor_rol: string | null;
      created_at: string;
    };
    const latestHistory = new Map<string, LinkHistoryRow>();
    for (const history of historyData as LinkHistoryRow[]) {
      const key = `${history.cartel_id}\u0000${history.territorial_feature_id}`;
      if (!latestHistory.has(key)) latestHistory.set(key, history);
    }

    for (const link of links) {
      const history = latestHistory.get(
        `${link.cartelId}\u0000${link.territorialFeatureId}`,
      );
      link.reason = history?.fundamento?.trim() ?? "";
      link.requesterName = history?.actor_nombre ?? null;
      link.requesterRole = history?.actor_rol ?? null;
      link.requestedAt = history?.created_at ?? link.requestedAt;
      if (link.reason.length < 5) invalidReference = true;
    }
  }

  return invalidReference
    ? {
        ok: false,
        data: links,
        error: "Hay vínculos pendientes sin referencia territorial verificable.",
      }
    : { ok: true, data: links, error: null };
}

export async function saveCartelLocation(cartel: CartelRecord) {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from("carteles")
    .update({
      domicilio: cartel.domicilio,
      numero: cartel.numero,
      latitud: cartel.latitud,
      longitud: cartel.longitud,
      location_source: cartel.locationSource,
      location_edited: cartel.locationEdited,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cartel.id)
    .select("id")
    .maybeSingle();
  if (error) console.warn("No se pudo guardar la corrección en Supabase:", error.message);
  return !error && data?.id === cartel.id;
}
