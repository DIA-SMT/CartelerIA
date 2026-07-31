"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ClipboardList,
  FileText,
  FolderOpen,
  Loader2,
  Lock,
  Paperclip,
  Printer,
  Save,
  X,
} from "lucide-react";
import {
  canTransition,
  getExpedienteState,
  type ExpedienteState,
} from "@/data/expedientes";
import type { StateChangeRequest } from "@/data/approvals";
import { getInspectionState } from "@/data/inspections";
import type { AuthState } from "@/hooks/use-auth";
import { useDismissible } from "@/hooks/use-dismissible";
import {
  loadStateChangeRequests,
  requestExpedienteStateChange,
  resolveStateChangeRequest,
} from "@/lib/approval-repository";
import {
  createExpediente,
  loadExpedienteByCartel,
  loadExpedienteDocumentos,
  loadExpedienteHistorial,
  updateExpediente,
  uploadExpedienteDocumento,
  type ExpedienteDocumento,
  type ExpedienteHistoryEntry,
  type ExpedienteRecord,
} from "@/lib/expediente-repository";
import { loadInspectionsByCartel, type InspectionRecord } from "@/lib/inspection-repository";
import { printExpedienteDossier } from "@/lib/expediente-report";
import { StateChangeApprovals } from "./state-change-approvals";

type Props = {
  cartelId: string;
  cartelName: string;
  prefill?: { empresa?: string | null; direccion?: string | null };
  auth: AuthState;
  canMutate: boolean;
  onClose: () => void;
};

export function ExpedientePanel({ cartelId, cartelName, prefill, auth, canMutate, onClose }: Props) {
  const { open, close } = useDismissible(onClose);
  const canRead = auth.canRead;
  const canManage = canMutate
    && auth.canRead
    && (auth.role === "administrador" || auth.role === "coordinador");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expediente, setExpediente] = useState<ExpedienteRecord | null>(null);
  const [inspecciones, setInspecciones] = useState<InspectionRecord[]>([]);
  const [historial, setHistorial] = useState<ExpedienteHistoryEntry[]>([]);
  const [requests, setRequests] = useState<StateChangeRequest[]>([]);
  const [requestsLoadError, setRequestsLoadError] = useState<string | null>(null);
  const [documentos, setDocumentos] = useState<ExpedienteDocumento[]>([]);
  const [busy, setBusy] = useState(false);
  const refreshSequence = useRef(0);

  useEffect(() => {
    // Capture + stopPropagation: abre sobre la ficha del cartel (que escucha
    // Esc en burbuja); sin esto un solo Esc cierra los dos paneles.
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [close]);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    if (!canRead) {
      setExpediente(null);
      setInspecciones([]);
      setHistorial([]);
      setRequests([]);
      setRequestsLoadError(null);
      setDocumentos([]);
      setError(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    setRequestsLoadError(null);
    try {
      const [exp, insp] = await Promise.all([
        loadExpedienteByCartel(cartelId),
        loadInspectionsByCartel(cartelId),
      ]);
      if (sequence !== refreshSequence.current) return;
      setExpediente(exp);
      setInspecciones(insp);
      if (exp) {
        const [hist, docs, requestData] = await Promise.all([
          loadExpedienteHistorial(exp.id),
          loadExpedienteDocumentos(exp.id),
          loadStateChangeRequests("expediente", exp.id),
        ]);
        if (sequence !== refreshSequence.current) return;
        setHistorial(hist);
        setDocumentos(docs);
        setRequests(requestData.data);
        setRequestsLoadError(requestData.ok ? null : requestData.error);
      } else {
        setHistorial([]);
        setDocumentos([]);
        setRequests([]);
        setRequestsLoadError(null);
      }
    } catch {
      if (sequence === refreshSequence.current) {
        setExpediente(null);
        setInspecciones([]);
        setHistorial([]);
        setRequests([]);
        setDocumentos([]);
        setError(true);
        setRequestsLoadError("No se pudo verificar el flujo de aprobaciones.");
      }
    } finally {
      if (sequence === refreshSequence.current) setLoading(false);
    }
  }, [cartelId, canRead]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshSequence.current += 1;
    };
  }, [refresh]);

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-ink/40 backdrop-blur-sm transition-opacity duration-200 ease-out sm:items-center sm:p-4" style={{ opacity: open ? 1 : 0 }} role="presentation" onClick={close}>
      <div role="dialog" aria-modal="true" aria-label={`Expediente de ${cartelName}`} className="flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-white bg-white shadow-2xl transition-[transform,opacity] duration-200 ease-spring will-change-transform sm:max-w-lg sm:rounded-2xl" style={{ opacity: open ? 1 : 0, transform: open ? "translate3d(0,0,0)" : "translate3d(0,18px,0)" }} onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 pb-3 pt-4">
          <div className="min-w-0">
            <span className="section-kicker">Expediente</span>
            <h2 className="truncate font-display text-base font-extrabold text-ink">{expediente?.numero || cartelName}</h2>
          </div>
          <button onClick={close} className="icon-button grid" aria-label="Cerrar"><X size={18}/></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="space-y-3" aria-label="Cargando expediente">
              <div className="skeleton h-7 w-44 rounded-lg"/>
              <div className="skeleton h-24 rounded-2xl"/>
              <div className="skeleton h-16 rounded-2xl"/>
              <div className="skeleton h-16 rounded-2xl"/>
            </div>
          ) : !canRead ? (
            auth.user && auth.roleError ? (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700"><p>{auth.roleError}</p><button type="button" onClick={() => void auth.retryRole()} className="secondary-button compact mt-2">Reintentar permisos</button></div>
            ) : (
              <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800"><Lock size={13} className="mt-0.5 shrink-0"/>{auth.user ? "Verificando permisos municipales…" : "Ingresá con tu cuenta municipal para ver el expediente."}</p>
            )
          ) : error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">No se pudo cargar el expediente. Reintentá más tarde.</p>
          ) : expediente ? (
            <ExpedienteView
              expediente={expediente}
              cartelName={cartelName}
              inspecciones={inspecciones}
              historial={historial}
              requests={requests}
              requestsLoadError={requestsLoadError}
              documentos={documentos}
              canManage={canManage}
              isAdmin={canMutate && auth.role === "administrador"}
              busy={busy}
              setBusy={setBusy}
              onChanged={refresh}
            />
          ) : (
            <NewExpediente
              cartelName={cartelName}
              cartelId={cartelId}
              prefill={prefill}
              canManage={canManage}
              busy={busy}
              setBusy={setBusy}
              onCreated={refresh}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Alta de expediente
// ----------------------------------------------------------------------------
function NewExpediente({ cartelName, cartelId, prefill, canManage, busy, setBusy, onCreated }: {
  cartelName: string; cartelId: string; prefill?: { empresa?: string | null; direccion?: string | null };
  canManage: boolean; busy: boolean; setBusy: (v: boolean) => void; onCreated: () => void;
}) {
  const [empresa, setEmpresa] = useState(prefill?.empresa ?? "");
  const [direccion, setDireccion] = useState(prefill?.direccion ?? "");
  const [observaciones, setObservaciones] = useState("");
  const [failed, setFailed] = useState(false);

  if (!canManage) {
    return <div className="grid min-h-40 place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
      <div><FolderOpen size={24} className="mx-auto text-slate-300"/><b className="mt-3 block text-xs text-ink">Este cartel no tiene expediente</b><p className="mt-1 text-[10px] leading-4 text-slate-500">Abrir un expediente requiere rol de coordinador o administrador.</p></div>
    </div>;
  }

  const create = async () => {
    setBusy(true);
    setFailed(false);
    const created = await createExpediente({
      cartelId,
      empresa: empresa.trim() || null,
      direccion: direccion.trim() || null,
      observaciones: observaciones.trim() || null,
    });
    setBusy(false);
    if (created) onCreated();
    else setFailed(true);
  };

  return <div className="space-y-3">
    <p className="text-[11px] text-slate-500">Abrí un expediente para <b className="text-slate-700">{cartelName}</b>. Agrupa sus inspecciones, historial y documentos.</p>
    <Field label="Empresa"><input value={empresa} onChange={(e) => setEmpresa(e.target.value)} className="w-full bg-transparent text-xs text-ink outline-none" placeholder="Razón social"/></Field>
    <Field label="Dirección"><input value={direccion} onChange={(e) => setDireccion(e.target.value)} className="w-full bg-transparent text-xs text-ink outline-none" placeholder="Domicilio del cartel"/></Field>
    <label className="block"><span className="detail-title">Observaciones</span><textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={3} className="mt-1.5 w-full rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-ink outline-none ring-1 ring-inset ring-slate-100 focus:ring-municipal-500"/></label>
    {failed && <p role="alert" className="text-[11px] font-semibold text-red-600">No se pudo abrir el expediente. Verificá tu sesión y permisos.</p>}
    <button type="button" onClick={create} disabled={busy} className="primary-button w-full justify-center disabled:opacity-60">{busy ? <Loader2 size={15} className="animate-spin"/> : <FolderOpen size={15}/>}Abrir expediente</button>
  </div>;
}

// ----------------------------------------------------------------------------
// Vista del expediente
// ----------------------------------------------------------------------------
function ExpedienteView({ expediente, cartelName, inspecciones, historial, requests, requestsLoadError, documentos, canManage, isAdmin, busy, setBusy, onChanged }: {
  expediente: ExpedienteRecord; cartelName: string; inspecciones: InspectionRecord[];
  historial: ExpedienteHistoryEntry[]; requests: StateChangeRequest[]; documentos: ExpedienteDocumento[];
  requestsLoadError: string | null;
  canManage: boolean; isAdmin: boolean; busy: boolean; setBusy: (v: boolean) => void; onChanged: () => Promise<void>;
}) {
  const config = getExpedienteState(expediente.estado);
  const [obs, setObs] = useState(expediente.observaciones ?? "");
  const [savedObs, setSavedObs] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const saveObs = async () => {
    setBusy(true);
    const ok = await updateExpediente(expediente.id, { observaciones: obs.trim() || null });
    setBusy(false);
    if (ok) { setSavedObs(true); onChanged(); }
  };

  const transition = async (next: ExpedienteState, reason: string) => {
    if (requestsLoadError) return false;
    setBusy(true);
    const result = await requestExpedienteStateChange(expediente.id, next, reason);
    if (result.ok) await onChanged();
    setBusy(false);
    return result.ok;
  };

  const resolveRequest = async (requestId: string, approve: boolean, note: string) => {
    if (requestsLoadError) return false;
    setBusy(true);
    const ok = await resolveStateChangeRequest(requestId, approve, note);
    if (ok) await onChanged();
    setBusy(false);
    return ok;
  };

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    setBusy(true);
    try {
      const ok = await uploadExpedienteDocumento(expediente.id, file, file.name);
      if (ok) await onChanged();
      else setUploadError("El archivo no fue incorporado al expediente. No lo uses como evidencia hasta reintentar y verificarlo.");
    } catch {
      setUploadError("No se pudo verificar la carga del archivo.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="space-y-4">
    {/* Encabezado */}
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="badge-soft"><i style={{ background: config.color }}/>{config.label}</span>
        <span className="text-micro font-bold text-slate-400">{expediente.numero}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-slate-600">
        <span><b className="text-slate-400">Cartel:</b> {cartelName}</span>
        {expediente.empresa && <span><b className="text-slate-400">Empresa:</b> {expediente.empresa}</span>}
        {expediente.direccion && <span className="col-span-2"><b className="text-slate-400">Dirección:</b> {expediente.direccion}</span>}
        <span><b className="text-slate-400">Apertura:</b> {new Date(expediente.createdAt).toLocaleDateString("es-AR")}</span>
        {expediente.cerradoEn && <span><b className="text-slate-400">Cierre:</b> {new Date(expediente.cerradoEn).toLocaleDateString("es-AR")}</span>}
      </div>
    </div>

    {/* Exportar PDF (dossier imprimible) */}
    <button type="button" onClick={() => printExpedienteDossier({ expediente, cartelName, inspecciones, historial, requests, documentos })} className="secondary-button compact w-full justify-center"><Printer size={12}/>Exportar PDF (dossier)</button>

    {/* Transiciones */}
    <StateChangeApprovals requests={requests} isAdmin={isAdmin} loadError={requestsLoadError} onResolve={resolveRequest}/>
    <Transitions estado={expediente.estado} canManage={canManage} isAdmin={isAdmin} hasPendingRequest={requests.some((request) => request.status === "pendiente")} approvalLoadError={requestsLoadError} busy={busy} onTransition={transition}/>

    {/* Inspecciones (rollup) */}
    <Section icon={<ClipboardList size={13}/>} title={`Inspecciones (${inspecciones.length})`}>
      {inspecciones.length === 0 ? (
        <p className="text-[10px] text-slate-400">Sin inspecciones registradas para este cartel.</p>
      ) : (
        <ul className="space-y-1">{inspecciones.slice(0, 8).map((insp) => {
          const s = getInspectionState(insp.estado);
          return <li key={insp.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-white px-2.5 py-1.5 text-[10px]">
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: s.color }}/>{s.label}</span>
            <time className="text-[9px] text-slate-400">{new Date(insp.createdAt).toLocaleDateString("es-AR")}</time>
          </li>;
        })}{inspecciones.length > 8 && <li className="px-1 text-[9px] font-semibold text-slate-400">y {inspecciones.length - 8} más…</li>}</ul>
      )}
    </Section>

    {/* Documentos */}
    <Section icon={<Paperclip size={13}/>} title={`Documentos (${documentos.length})`}>
      {documentos.length > 0 && <ul className="mb-2 space-y-1">{documentos.map((doc) => (
        <li key={doc.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-white px-2.5 py-1.5 text-[10px]">
          <span className="flex min-w-0 items-center gap-1.5"><FileText size={11} className="shrink-0 text-slate-400"/><span className="min-w-0"><span className="block truncate">{doc.descripcion || doc.storagePath.split("/").pop()}</span><span className={`block text-[8px] font-bold ${doc.sha256 && doc.byteSize && doc.mimeType && doc.uploadedBy ? "text-green-700" : "text-amber-700"}`}>{doc.sha256 && doc.byteSize && doc.mimeType && doc.uploadedBy ? "Integridad verificada" : "Histórico no verificado"}</span></span></span>
          {doc.url && <a href={doc.url} target="_blank" rel="noreferrer" className="shrink-0 text-[9px] font-bold text-municipal-700 hover:text-municipal-900">Ver</a>}
        </li>
      ))}</ul>}
      {canManage ? (
        <label className="secondary-button compact inline-flex w-full cursor-pointer justify-center">
          <Paperclip size={12}/>Adjuntar documento
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif" className="hidden" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void onUpload(file); }}/>
        </label>
      ) : documentos.length === 0 && <p className="text-[10px] text-slate-400">Sin documentos.</p>}
      {uploadError && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-2.5 py-2 text-[9px] font-semibold text-red-700">{uploadError}</p>}
    </Section>

    {/* Observaciones (editable por rol) */}
    <Section icon={<FileText size={13}/>} title="Observaciones">
      {canManage ? (
        <div className="space-y-1.5">
          <textarea value={obs} onChange={(e) => { setObs(e.target.value); setSavedObs(false); }} rows={3} className="w-full rounded-xl bg-slate-50 px-3 py-2 text-xs text-ink outline-none ring-1 ring-inset ring-slate-100 focus:ring-municipal-500"/>
          <button type="button" onClick={saveObs} disabled={busy} className="secondary-button compact justify-center disabled:opacity-60"><Save size={12}/>{savedObs ? "Guardado" : "Guardar"}</button>
        </div>
      ) : (
        <p className="text-[10px] leading-4 text-slate-500">{expediente.observaciones || "Sin observaciones."}</p>
      )}
    </Section>

    {/* Historial */}
    <Section icon={<ArrowRight size={13}/>} title="Historial">
      {historial.length === 0 ? <p className="text-[10px] text-slate-400">Sin movimientos.</p> : (
        <ol className="space-y-1.5">{historial.map((entry) => {
          const to = getExpedienteState(entry.estadoNuevo);
          const from = entry.estadoAnterior ? getExpedienteState(entry.estadoAnterior) : null;
          return <li key={entry.id} className="flex items-center gap-1.5 text-[10px] text-slate-600">
            <span className="size-1.5 shrink-0 rounded-full" style={{ background: to.color }}/>
            <span className="flex flex-wrap items-center gap-1">{from && <><b className="font-semibold text-slate-400">{from.label}</b><ArrowRight size={9} className="text-slate-300"/></>}<b className="font-bold text-slate-700">{to.label}</b>{entry.changedByName && <span className="text-[9px] text-slate-400">· {entry.changedByName}{entry.changedByRole ? ` (${entry.changedByRole})` : ""}</span>}</span>
            <time className="ml-auto shrink-0 text-[9px] text-slate-400">{new Date(entry.createdAt).toLocaleDateString("es-AR")}</time>
          </li>;
        })}</ol>
      )}
    </Section>
  </div>;
}

function Transitions({ estado, canManage, isAdmin, hasPendingRequest, approvalLoadError, busy, onTransition }: { estado: ExpedienteState; canManage: boolean; isAdmin: boolean; hasPendingRequest: boolean; approvalLoadError: string | null; busy: boolean; onTransition: (next: ExpedienteState, reason: string) => Promise<boolean> }) {
  const [reason, setReason] = useState("");
  const config = getExpedienteState(estado);
  if (!canManage) {
    return <p className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[9px] font-semibold text-slate-500"><Lock size={11}/>Cambiar el estado requiere rol coordinador o administrador.</p>;
  }
  if (approvalLoadError) {
    return <p className="rounded-lg bg-red-50 px-2.5 py-1.5 text-[9px] font-semibold text-red-700">No se habilitan transiciones porque no se pudo verificar si existen solicitudes pendientes.</p>;
  }
  if (config.allowedNext.length === 0) {
    return <p className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[9px] font-semibold text-slate-500">Estado final: sin transiciones disponibles.</p>;
  }
  if (hasPendingRequest) {
    return <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[9px] font-semibold text-amber-800">Hay una solicitud pendiente de resolución administrativa.</p>;
  }
  return <div>
    <span className="micro-label">{isAdmin ? "Aplicar estado con aprobación" : "Solicitar cambio de estado"}</span>
    <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} placeholder="Fundamento obligatorio" className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[10px] text-slate-700 outline-none focus:border-municipal-500"/>
    <div className="mt-1.5 flex flex-wrap gap-1.5">{config.allowedNext.filter((next) => canTransition(estado, next)).map((next) => {
      const target = getExpedienteState(next);
      return <button key={next} type="button" disabled={busy || reason.trim().length < 5} onClick={async () => { if (await onTransition(next, reason.trim())) setReason(""); }} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[9px] font-bold text-slate-600 transition hover:border-municipal-300 hover:text-municipal-700 disabled:opacity-50">
        <span className="size-2 rounded-full" style={{ background: target.color }}/>{target.label}
      </button>;
    })}</div>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="detail-title">{label}</span><div className="filter-input mt-1.5">{children}</div></label>;
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <div>
    <div className="micro-label mb-1.5 flex items-center gap-1.5">{icon}{title}</div>
    {children}
  </div>;
}
