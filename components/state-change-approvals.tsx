"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  XCircle,
} from "lucide-react";
import {
  APPROVAL_STATUS_LABELS,
  stateChangeLabel,
  type ApprovalStatus,
  type StateChangeRequest,
} from "@/data/approvals";

type Props = {
  requests: StateChangeRequest[];
  isAdmin: boolean;
  loadError?: string | null;
  onResolve: (requestId: string, approve: boolean, note: string) => Promise<boolean>;
};

export function StateChangeApprovals({
  requests,
  isAdmin,
  loadError = null,
  onResolve,
}: Props) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const resolvingIds = useRef(new Set<string>());
  const pending = requests.filter((request) => request.status === "pendiente");
  const resolved = requests.filter((request) => request.status !== "pendiente").slice(0, 5);

  if (requests.length === 0 && !loadError) return null;

  const resolve = async (request: StateChangeRequest, approve: boolean) => {
    const note = notes[request.id]?.trim() ?? "";
    if (
      note.length < 5
      || loadError
      || resolvingIds.current.has(request.id)
      || !window.confirm(
        `${approve ? "Aprobar" : "Rechazar"} el cambio de ${stateChangeLabel(request, "previous")} a ${stateChangeLabel(request, "requested")}?\n\nLa resolución quedará asentada en el historial.`,
      )
    ) return;

    resolvingIds.current.add(request.id);
    setBusyId(request.id);
    setFailedId(null);
    try {
      const ok = await onResolve(request.id, approve, note);
      if (!ok) setFailedId(request.id);
    } finally {
      resolvingIds.current.delete(request.id);
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-2">
      <span className="text-[8px] font-extrabold uppercase tracking-wider text-slate-400">
        Solicitudes de aprobación
      </span>
      {loadError && (
        <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[9px] font-semibold leading-4 text-red-700">
          <AlertTriangle size={11} className="mt-0.5 shrink-0"/>
          <span>{loadError} Los cambios quedan bloqueados hasta volver a verificar las solicitudes.</span>
        </p>
      )}
      {pending.map((request) => {
        const note = notes[request.id] ?? "";
        const busy = busyId === request.id;
        return (
          <div key={request.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-start gap-2">
              <Clock3 size={13} className="mt-0.5 shrink-0 text-amber-700"/>
              <div className="min-w-0 text-[10px] leading-4 text-amber-900">
                <b>{stateChangeLabel(request, "previous")} → {stateChangeLabel(request, "requested")}</b>
                <p className="text-amber-800">{request.reason}</p>
                <p className="mt-1 text-[9px] text-amber-700">
                  Solicitó {request.requesterName || request.requestedBy}
                  {request.requesterRole ? ` · ${request.requesterRole}` : ""}
                  {" · "}{new Date(request.createdAt).toLocaleString("es-AR")}
                </p>
              </div>
            </div>
            {isAdmin && (
              <>
                <textarea
                  value={note}
                  onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                  rows={2}
                  placeholder="Fundamento de la resolución (obligatorio)"
                  className="mt-2 w-full rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-[10px] text-slate-700 outline-none focus:border-municipal-500"
                />
                <div className="mt-2 flex gap-1.5">
                  <button type="button" disabled={Boolean(loadError) || busy || note.trim().length < 5} onClick={() => resolve(request, true)} className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1.5 text-[9px] font-extrabold text-white disabled:opacity-50">
                    {busy ? <Loader2 size={10} className="animate-spin"/> : <CheckCircle2 size={10}/>}
                    Aprobar
                  </button>
                  <button type="button" disabled={Boolean(loadError) || busy || note.trim().length < 5} onClick={() => resolve(request, false)} className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1.5 text-[9px] font-extrabold text-white disabled:opacity-50">
                    <XCircle size={10}/>
                    Rechazar
                  </button>
                </div>
                {failedId === request.id && <p role="alert" className="mt-1.5 text-[9px] font-semibold text-red-700">No se pudo resolver la solicitud.</p>}
              </>
            )}
          </div>
        );
      })}
      {resolved.length > 0 && (
        <ul className="space-y-1">
          {resolved.map((request) => (
            <li key={request.id} className="rounded-lg bg-slate-50 px-2.5 py-2 text-[9px] text-slate-500">
              <b className={approvalStatusClass(request.status)}>
                {APPROVAL_STATUS_LABELS[request.status]}
              </b>
              {" · "}{stateChangeLabel(request, "previous")} → {stateChangeLabel(request, "requested")}
              {request.resolverName && ` · ${request.resolverName}`}
              {request.resolutionNote && <span className="mt-0.5 block">{request.resolutionNote}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function approvalStatusClass(status: ApprovalStatus): string {
  switch (status) {
    case "aprobada":
      return "text-green-700";
    case "rechazada":
      return "text-red-700";
    case "cancelada":
      return "text-slate-600";
    case "pendiente":
      return "text-amber-700";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}
