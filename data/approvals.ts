import type { AppRole } from "@/hooks/use-auth";
import {
  EXPEDIENTE_STATES,
  type ExpedienteState,
} from "@/data/expedientes";
import {
  INSPECTION_STATES,
  type InspectionState,
} from "@/data/inspections";

export type ApprovalStatus = "pendiente" | "aprobada" | "rechazada" | "cancelada";
export type ApprovalEntity = "inspeccion" | "expediente";

export type LoadResult<T> =
  | { ok: true; data: T; error: null }
  | { ok: false; data: T; error: string };

export interface ApprovalContext {
  verified: boolean;
  cartelId: string | null;
  recordLabel: string;
  empresa: string | null;
  direccion: string | null;
}

interface StateChangeRequestBase {
  id: string;
  reason: string;
  status: ApprovalStatus;
  requestedBy: string;
  requesterName: string | null;
  requesterRole: AppRole | null;
  resolvedBy: string | null;
  resolverName: string | null;
  resolverRole: AppRole | null;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  context: ApprovalContext;
}

export interface InspectionStateChangeRequest extends StateChangeRequestBase {
  entity: "inspeccion";
  inspectionId: string;
  expedienteId: null;
  previousState: InspectionState;
  requestedState: InspectionState;
}

export interface ExpedienteStateChangeRequest extends StateChangeRequestBase {
  entity: "expediente";
  inspectionId: null;
  expedienteId: string;
  previousState: ExpedienteState;
  requestedState: ExpedienteState;
}

export type StateChangeRequest =
  | InspectionStateChangeRequest
  | ExpedienteStateChangeRequest;

export type StateChangeResult =
  | { ok: true; outcome: "applied" | "pending"; requestId: string }
  | { ok: false; outcome: "error"; requestId: null };

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  cancelada: "Cancelada",
};

export function stateChangeLabel(
  request: StateChangeRequest,
  position: "previous" | "requested",
): string {
  switch (request.entity) {
    case "inspeccion":
      return INSPECTION_STATES[
        position === "previous" ? request.previousState : request.requestedState
      ].label;
    case "expediente":
      return EXPEDIENTE_STATES[
        position === "previous" ? request.previousState : request.requestedState
      ].label;
    default: {
      const exhaustive: never = request;
      return exhaustive;
    }
  }
}
