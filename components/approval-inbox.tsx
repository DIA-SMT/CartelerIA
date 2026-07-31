"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Link2,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import {
  stateChangeLabel,
  type StateChangeRequest,
} from "@/data/approvals";
import { useAuth } from "@/hooks/use-auth";
import {
  loadPendingStateChangeRequests,
  resolveStateChangeRequest,
} from "@/lib/approval-repository";
import {
  loadPendingCartelLinks,
  resolveCartelTerritorialLink,
  type PendingCartelLink,
} from "@/lib/cartel-repository";
import { ConfirmDialog } from "./confirm-dialog";
import { toast } from "./toaster";

type LoadPhase = "idle" | "loading" | "ready" | "error";

type PendingResolution =
  | { kind: "state"; request: StateChangeRequest; approve: boolean; note: string }
  | { kind: "link"; request: PendingCartelLink; approve: boolean; note: string };

export function ApprovalInbox() {
  const auth = useAuth();
  const isAdmin = auth.canRead && auth.role === "administrador";
  const [stateRequests, setStateRequests] = useState<StateChangeRequest[]>([]);
  const [linkRequests, setLinkRequests] = useState<PendingCartelLink[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [dataOwnerId, setDataOwnerId] = useState<string | null>(null);
  const [pendingResolution, setPendingResolution] = useState<PendingResolution | null>(null);
  const refreshSequence = useRef(0);
  const resolvingIds = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    if (!isAdmin) {
      setStateRequests([]);
      setLinkRequests([]);
      setNotes({});
      setLoadError(null);
      setLoadPhase("idle");
      setDataOwnerId(null);
      return;
    }

    setStateRequests([]);
    setLinkRequests([]);
    setNotes({});
    setBusyId(null);
    setFailedId(null);
    setDataOwnerId(null);
    setLoadPhase("loading");
    setLoadError(null);
    const [statesResult, linksResult] = await Promise.all([
      loadPendingStateChangeRequests(),
      loadPendingCartelLinks(),
    ]);
    if (sequence !== refreshSequence.current) return;

    setDataOwnerId(auth.user?.id ?? null);
    setStateRequests(statesResult.data);
    setLinkRequests(linksResult.data);
    const errors = [
      statesResult.ok ? null : statesResult.error,
      linksResult.ok ? null : linksResult.error,
    ].filter((error): error is string => Boolean(error));
    setLoadError(errors.join(" "));
    setLoadPhase(errors.length > 0 ? "error" : "ready");
  }, [isAdmin, auth.user?.id]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshSequence.current += 1;
    };
  }, [refresh]);

  if (!isAdmin) return null;
  const ownsData = dataOwnerId === auth.user?.id;

  // Paso 1: el click solo valida y abre el diálogo de confirmación propio
  // (reemplaza window.confirm) mostrando el fundamento que se va a asentar.
  const resolveState = (request: StateChangeRequest, approve: boolean) => {
    const id = `state-${request.id}`;
    const note = notes[id]?.trim() ?? "";
    if (note.length < 5 || loadPhase !== "ready" || resolvingIds.current.has(id)) return;
    setPendingResolution({ kind: "state", request, approve, note });
  };

  const resolveLink = (request: PendingCartelLink, approve: boolean) => {
    const id = `link-${request.cartelId}`;
    const note = notes[id]?.trim() ?? "";
    if (note.length < 5 || loadPhase !== "ready" || resolvingIds.current.has(id)) return;
    setPendingResolution({ kind: "link", request, approve, note });
  };

  // Paso 2: confirmado en el diálogo, se ejecuta la resolución.
  const executeResolution = async (resolution: PendingResolution) => {
    setPendingResolution(null);
    const id = resolution.kind === "state" ? `state-${resolution.request.id}` : `link-${resolution.request.cartelId}`;
    if (resolvingIds.current.has(id)) return;
    resolvingIds.current.add(id);
    setBusyId(id);
    setFailedId(null);
    try {
      const ok = resolution.kind === "state"
        ? await resolveStateChangeRequest(resolution.request.id, resolution.approve, resolution.note)
        : await resolveCartelTerritorialLink(resolution.request.cartelId, resolution.approve, resolution.note);
      if (ok) {
        toast(resolution.approve ? "Solicitud aprobada y asentada en la bitácora." : "Solicitud rechazada y asentada en la bitácora.");
        window.dispatchEvent(new Event("carteleria:administrative-refresh"));
        await refresh();
      } else {
        setFailedId(id);
        toast("No se pudo resolver la solicitud.", "error");
      }
    } finally {
      resolvingIds.current.delete(id);
      setBusyId(null);
    }
  };

  const total = stateRequests.length + linkRequests.length;
  return (
    <section id="aprobaciones" className="section-block">
      <div className="section-heading">
        <div>
          <span className="section-kicker">Administración</span>
          <h2>Aprobaciones pendientes</h2>
          <p>Resoluciones trazables de estados y vínculos territoriales.</p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loadPhase === "loading" || busyId !== null}
          className="secondary-button compact"
        >
          <RefreshCw size={13} className={loadPhase === "loading" ? "animate-spin" : ""}/>
          Actualizar
        </button>
      </div>

      {!ownsData || loadPhase === "idle" || loadPhase === "loading" ? (
        <div className="grid gap-3 lg:grid-cols-2" aria-label="Cargando aprobaciones">
          <div className="skeleton h-32 rounded-2xl"/>
          <div className="skeleton h-32 rounded-2xl"/>
        </div>
      ) : (
        <>
          {loadError && (
            <div role="alert" className="mb-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-[10px] font-semibold leading-4 text-red-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0"/>
              <span>{loadError} Las resoluciones quedan bloqueadas hasta completar una actualización válida.</span>
            </div>
          )}
          {loadPhase === "ready" && total === 0 ? (
            <div className="rounded-2xl border border-green-100 bg-green-50 p-5 text-center">
              <ClipboardCheck size={22} className="mx-auto text-green-600"/>
              <b className="mt-2 block text-xs text-green-900">No hay aprobaciones pendientes</b>
            </div>
          ) : total > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {stateRequests.map((request) => {
                const id = `state-${request.id}`;
                const note = notes[id] ?? "";
                const context = [
                  request.context.recordLabel,
                  request.context.cartelId ? `Cartel ${request.context.cartelId}` : null,
                  request.context.empresa ? `Empresa: ${request.context.empresa}` : null,
                  request.context.direccion ? `Dirección: ${request.context.direccion}` : null,
                ].filter((value): value is string => Boolean(value));
                return (
                  <ApprovalCard
                    key={id}
                    icon={<ClipboardCheck size={15}/>}
                    title={`${request.entity === "inspeccion" ? "Inspección" : "Expediente"} · ${stateChangeLabel(request, "previous")} → ${stateChangeLabel(request, "requested")}`}
                    detail={request.reason}
                    context={context}
                    meta={`${request.requesterName || request.requestedBy}${request.requesterRole ? ` · ${request.requesterRole}` : ""} · ${new Date(request.createdAt).toLocaleString("es-AR")}`}
                    note={note}
                    busy={busyId === id}
                    blocked={loadPhase !== "ready"}
                    failed={failedId === id}
                    onNote={(value) => setNotes((current) => ({ ...current, [id]: value }))}
                    onApprove={() => resolveState(request, true)}
                    onReject={() => resolveState(request, false)}
                  />
                );
              })}
              {linkRequests.map((request) => {
                const id = `link-${request.cartelId}`;
                const note = notes[id] ?? "";
                return (
                  <ApprovalCard
                    key={id}
                    icon={<Link2 size={15}/>}
                    title={`Vínculo territorial · ${request.territorialFeatureId}`}
                    detail={request.reason || "Fundamento no verificable"}
                    context={[
                      `Registro ${request.cartelId}`,
                      ...(request.empresa ? [`Empresa: ${request.empresa}`] : []),
                      ...(request.direccion ? [`Dirección: ${request.direccion}`] : []),
                    ]}
                    meta={[
                      request.requesterName,
                      request.requesterRole,
                      request.requestedAt
                        ? new Date(request.requestedAt).toLocaleString("es-AR")
                        : "Fecha no disponible",
                    ].filter(Boolean).join(" · ")}
                    note={note}
                    busy={busyId === id}
                    blocked={loadPhase !== "ready"}
                    failed={failedId === id}
                    onNote={(value) => setNotes((current) => ({ ...current, [id]: value }))}
                    onApprove={() => resolveLink(request, true)}
                    onReject={() => resolveLink(request, false)}
                  />
                );
              })}
            </div>
          ) : null}
        </>
      )}

      {pendingResolution && (
        <ConfirmDialog
          title={`${pendingResolution.approve ? "Aprobar" : "Rechazar"} solicitud`}
          description={pendingResolution.kind === "state"
            ? `Cambio de ${stateChangeLabel(pendingResolution.request, "previous")} a ${stateChangeLabel(pendingResolution.request, "requested")}. La resolución quedará registrada con este fundamento:`
            : `Vínculo del registro ${pendingResolution.request.cartelId} con el punto territorial ${pendingResolution.request.territorialFeatureId}. La resolución quedará registrada con este fundamento:`}
          quote={pendingResolution.note}
          tone={pendingResolution.approve ? "approve" : "reject"}
          confirmLabel={pendingResolution.approve ? "Aprobar" : "Rechazar"}
          onConfirm={() => void executeResolution(pendingResolution)}
          onCancel={() => setPendingResolution(null)}
        />
      )}
    </section>
  );
}

function ApprovalCard({
  icon,
  title,
  detail,
  context,
  meta,
  note,
  busy,
  blocked,
  failed,
  onNote,
  onApprove,
  onReject,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  context: string[];
  meta: string;
  note: string;
  busy: boolean;
  blocked: boolean;
  failed: boolean;
  onNote: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <article className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700">{icon}</span>
        <div className="min-w-0">
          <b className="text-[11px] text-ink">{title}</b>
          <p className="mt-0.5 text-[10px] text-slate-600">{detail}</p>
          <ul className="mt-1 space-y-0.5 text-micro font-semibold text-slate-500">
            {context.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <p className="mt-1 text-micro text-slate-400">{meta}</p>
        </div>
      </div>
      <textarea
        value={note}
        onChange={(event) => onNote(event.target.value)}
        rows={2}
        placeholder="Fundamento de la resolución (obligatorio)"
        className="mt-3 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[10px] text-slate-700 outline-none focus:border-municipal-500"
      />
      <div className="mt-2.5 flex gap-2">
        <button type="button" disabled={blocked || busy || note.trim().length < 5} onClick={onApprove} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-green-700 px-3.5 text-micro font-extrabold text-white transition duration-fast hover:bg-green-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? <Loader2 size={12} className="animate-spin"/> : <CheckCircle2 size={12}/>}
          Aprobar
        </button>
        <button type="button" disabled={blocked || busy || note.trim().length < 5} onClick={onReject} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3.5 text-micro font-extrabold text-red-700 transition duration-fast hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
          <XCircle size={12}/>
          Rechazar
        </button>
      </div>
      {failed && <p role="alert" className="mt-1.5 text-micro font-semibold text-red-700">No se pudo resolver la solicitud.</p>}
    </article>
  );
}
