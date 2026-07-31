import type { ExpedienteState } from "@/data/expedientes";
import {
  isExpedienteState,
} from "@/data/expedientes";
import {
  isInspectionState,
  type InspectionState,
} from "@/data/inspections";
import type {
  ApprovalContext,
  ApprovalEntity,
  LoadResult,
  StateChangeRequest,
  StateChangeResult,
} from "@/data/approvals";
import { supabase } from "./supabase";

type RequestRow = {
  id: string;
  entidad: ApprovalEntity;
  inspeccion_id: string | null;
  expediente_id: string | null;
  estado_anterior: string;
  estado_solicitado: string;
  fundamento: string;
  estado: StateChangeRequest["status"];
  solicitado_por: string;
  solicitante_nombre: string | null;
  solicitante_rol: StateChangeRequest["requesterRole"];
  resuelto_por: string | null;
  resolutor_nombre: string | null;
  resolutor_rol: StateChangeRequest["resolverRole"];
  nota_resolucion: string | null;
  created_at: string;
  resolved_at: string | null;
};

const REQUEST_SELECT =
  "id, entidad, inspeccion_id, expediente_id, estado_anterior, estado_solicitado, fundamento, estado, solicitado_por, solicitante_nombre, solicitante_rol, resuelto_por, resolutor_nombre, resolutor_rol, nota_resolucion, created_at, resolved_at";

function baseRequest(row: RequestRow) {
  return {
    id: row.id,
    reason: row.fundamento,
    status: row.estado,
    requestedBy: row.solicitado_por,
    requesterName: row.solicitante_nombre,
    requesterRole: row.solicitante_rol,
    resolvedBy: row.resuelto_por,
    resolverName: row.resolutor_nombre,
    resolverRole: row.resolutor_rol,
    resolutionNote: row.nota_resolucion,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    context: {
      verified: false,
      cartelId: null,
      recordLabel: row.entidad === "inspeccion"
        ? `Inspección ${row.inspeccion_id ?? "sin identificar"}`
        : `Expediente ${row.expediente_id ?? "sin identificar"}`,
      empresa: null,
      direccion: null,
    } satisfies ApprovalContext,
  };
}

function fromRow(row: RequestRow): StateChangeRequest | null {
  const base = baseRequest(row);
  if (
    row.entidad === "inspeccion"
    && row.inspeccion_id
    && row.expediente_id === null
    && isInspectionState(row.estado_anterior)
    && isInspectionState(row.estado_solicitado)
  ) {
    return {
      ...base,
      entity: "inspeccion",
      inspectionId: row.inspeccion_id,
      expedienteId: null,
      previousState: row.estado_anterior,
      requestedState: row.estado_solicitado,
    };
  }
  if (
    row.entidad === "expediente"
    && row.expediente_id
    && row.inspeccion_id === null
    && isExpedienteState(row.estado_anterior)
    && isExpedienteState(row.estado_solicitado)
  ) {
    return {
      ...base,
      entity: "expediente",
      inspectionId: null,
      expedienteId: row.expediente_id,
      previousState: row.estado_anterior,
      requestedState: row.estado_solicitado,
    };
  }
  return null;
}

function parseRows(rows: RequestRow[]): LoadResult<StateChangeRequest[]> {
  const parsed = rows.map(fromRow);
  if (parsed.some((request) => request === null)) {
    return {
      ok: false,
      data: parsed.filter((request): request is StateChangeRequest => request !== null),
      error: "Hay solicitudes con entidad, referencia o estado inválido.",
    };
  }
  return { ok: true, data: parsed as StateChangeRequest[], error: null };
}

function parseRpcResult(data: unknown): StateChangeResult {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    return { ok: false, outcome: "error", requestId: null };
  }
  const value = row as { resultado?: unknown; solicitud_id?: unknown };
  if (
    (value.resultado === "aplicado" || value.resultado === "pendiente")
    && typeof value.solicitud_id === "string"
  ) {
    return {
      ok: true,
      outcome: value.resultado === "aplicado" ? "applied" : "pending",
      requestId: value.solicitud_id,
    };
  }
  return { ok: false, outcome: "error", requestId: null };
}

export async function requestInspectionStateChange(
  inspectionId: string,
  state: InspectionState,
  reason: string,
): Promise<StateChangeResult> {
  if (!supabase) return { ok: false, outcome: "error", requestId: null };
  const { data, error } = await supabase.rpc("solicitar_cambio_estado_inspeccion", {
    p_inspeccion_id: inspectionId,
    p_estado_nuevo: state,
    p_fundamento: reason,
  });
  return error ? { ok: false, outcome: "error", requestId: null } : parseRpcResult(data);
}

export async function requestExpedienteStateChange(
  expedienteId: string,
  state: ExpedienteState,
  reason: string,
): Promise<StateChangeResult> {
  if (!supabase) return { ok: false, outcome: "error", requestId: null };
  const { data, error } = await supabase.rpc("solicitar_cambio_estado_expediente", {
    p_expediente_id: expedienteId,
    p_estado_nuevo: state,
    p_fundamento: reason,
  });
  return error ? { ok: false, outcome: "error", requestId: null } : parseRpcResult(data);
}

export async function loadStateChangeRequests(
  entity: ApprovalEntity,
  entityId: string,
): Promise<LoadResult<StateChangeRequest[]>> {
  if (!supabase) {
    return { ok: false, data: [], error: "Supabase no está configurado." };
  }
  const idField = entity === "inspeccion" ? "inspeccion_id" : "expediente_id";
  const { data, error } = await supabase
    .from("cambio_estado_solicitudes")
    .select(REQUEST_SELECT)
    .eq(idField, entityId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error || !data) {
    return {
      ok: false,
      data: [],
      error: "No se pudo verificar el historial de aprobaciones.",
    };
  }
  return parseRows(data as RequestRow[]);
}

type InspectionContextRow = {
  id: string;
  cartel_id: string;
  empresa: string | null;
};

type ExpedienteContextRow = {
  id: string;
  numero: string | null;
  cartel_id: string;
  empresa: string | null;
  direccion: string | null;
};

type CartelContextRow = {
  id: string;
  empresa: string | null;
  domicilio: string | null;
  numero: string | null;
};

async function enrichContexts(
  requests: StateChangeRequest[],
): Promise<LoadResult<StateChangeRequest[]>> {
  if (!supabase || requests.length === 0) {
    return { ok: true, data: requests, error: null };
  }

  const inspectionIds = requests.flatMap((request) =>
    request.entity === "inspeccion" ? [request.inspectionId] : []
  );
  const expedienteIds = requests.flatMap((request) =>
    request.entity === "expediente" ? [request.expedienteId] : []
  );

  const [inspectionResult, expedienteResult] = await Promise.all([
    inspectionIds.length
      ? supabase
          .from("inspecciones")
          .select("id, cartel_id, empresa")
          .in("id", inspectionIds)
      : Promise.resolve({ data: [] as InspectionContextRow[], error: null }),
    expedienteIds.length
      ? supabase
          .from("expedientes")
          .select("id, numero, cartel_id, empresa, direccion")
          .in("id", expedienteIds)
      : Promise.resolve({ data: [] as ExpedienteContextRow[], error: null }),
  ]);

  if (inspectionResult.error || expedienteResult.error) {
    return {
      ok: false,
      data: requests,
      error: "No se pudo verificar el contexto administrativo de las solicitudes.",
    };
  }

  const inspections = inspectionResult.data as InspectionContextRow[];
  const expedientes = expedienteResult.data as ExpedienteContextRow[];
  const inspectionById = new Map(inspections.map((row) => [row.id, row]));
  const expedienteById = new Map(expedientes.map((row) => [row.id, row]));
  const cartelIds = Array.from(new Set([
    ...inspections.map((row) => row.cartel_id),
    ...expedientes.map((row) => row.cartel_id),
  ]));

  const cartelResult = cartelIds.length
    ? await supabase
        .from("carteles")
        .select("id, empresa, domicilio, numero")
        .in("id", cartelIds)
    : { data: [] as CartelContextRow[], error: null };

  const cartelById = new Map(
    ((cartelResult.data ?? []) as CartelContextRow[]).map((row) => [row.id, row]),
  );
  let missingContext = Boolean(cartelResult.error);

  const enriched = requests.map((request): StateChangeRequest => {
    if (request.entity === "inspeccion") {
      const inspection = inspectionById.get(request.inspectionId);
      if (!inspection) {
        missingContext = true;
        return request;
      }
      const cartel = cartelById.get(inspection.cartel_id);
      if (!cartel) missingContext = true;
      return {
        ...request,
        context: {
          verified: Boolean(cartel),
          cartelId: inspection.cartel_id,
          recordLabel: `Inspección ${request.inspectionId}`,
          empresa: inspection.empresa || cartel?.empresa || null,
          direccion: [cartel?.domicilio, cartel?.numero].filter(Boolean).join(" ") || null,
        },
      };
    }

    const expediente = expedienteById.get(request.expedienteId);
    if (!expediente) {
      missingContext = true;
      return request;
    }
    const cartel = cartelById.get(expediente.cartel_id);
    if (!cartel) missingContext = true;
    return {
      ...request,
      context: {
        verified: Boolean(cartel),
        cartelId: expediente.cartel_id,
        recordLabel: `Expediente ${expediente.numero || request.expedienteId}`,
        empresa: expediente.empresa || cartel?.empresa || null,
        direccion: expediente.direccion
          || [cartel?.domicilio, cartel?.numero].filter(Boolean).join(" ")
          || null,
      },
    };
  });

  return missingContext
    ? {
        ok: false,
        data: enriched,
        error: "No se pudo verificar el cartel asociado a una o más solicitudes.",
      }
    : { ok: true, data: enriched, error: null };
}

export async function loadPendingStateChangeRequests(): Promise<LoadResult<StateChangeRequest[]>> {
  if (!supabase) {
    return { ok: false, data: [], error: "Supabase no está configurado." };
  }
  const { data, error } = await supabase
    .from("cambio_estado_solicitudes")
    .select(REQUEST_SELECT)
    .eq("estado", "pendiente")
    .order("created_at", { ascending: true });
  if (error || !data) {
    return {
      ok: false,
      data: [],
      error: "No se pudieron cargar las solicitudes de estado pendientes.",
    };
  }
  const parsed = parseRows(data as RequestRow[]);
  if (!parsed.ok) return parsed;
  return enrichContexts(parsed.data);
}

export async function resolveStateChangeRequest(
  requestId: string,
  approve: boolean,
  note: string,
): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("resolver_solicitud_cambio_estado", {
    p_solicitud_id: requestId,
    p_aprobar: approve,
    p_nota: note,
  });
  return !error && data === true;
}
