"use client";

import { useCallback, useEffect, useState } from "react";
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
import { getInspectionState } from "@/data/inspections";
import type { AuthState } from "@/hooks/use-auth";
import {
  createExpediente,
  loadExpedienteByCartel,
  loadExpedienteDocumentos,
  loadExpedienteHistorial,
  updateExpediente,
  updateExpedienteEstado,
  uploadExpedienteDocumento,
  type ExpedienteDocumento,
  type ExpedienteHistoryEntry,
  type ExpedienteRecord,
} from "@/lib/expediente-repository";
import { loadInspectionsByCartel, type InspectionRecord } from "@/lib/inspection-repository";
import { printExpedienteDossier } from "@/lib/expediente-report";

type Props = {
  cartelId: string;
  cartelName: string;
  prefill?: { empresa?: string | null; direccion?: string | null };
  auth: AuthState;
  onClose: () => void;
};

export function ExpedientePanel({ cartelId, cartelName, prefill, auth, onClose }: Props) {
  const canRead = auth.available && Boolean(auth.user);
  const canManage = auth.available && (auth.role === "administrador" || auth.role === "coordinador");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expediente, setExpediente] = useState<ExpedienteRecord | null>(null);
  const [inspecciones, setInspecciones] = useState<InspectionRecord[]>([]);
  const [historial, setHistorial] = useState<ExpedienteHistoryEntry[]>([]);
  const [documentos, setDocumentos] = useState<ExpedienteDocumento[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const refresh = useCallback(async () => {
    if (!canRead) { setLoading(false); return; }
    setLoading(true);
    setError(false);
    try {
      const [exp, insp] = await Promise.all([
        loadExpedienteByCartel(cartelId),
        loadInspectionsByCartel(cartelId),
      ]);
      setExpediente(exp);
      setInspecciones(insp);
      if (exp) {
        const [hist, docs] = await Promise.all([
          loadExpedienteHistorial(exp.id),
          loadExpedienteDocumentos(exp.id),
        ]);
        setHistorial(hist);
        setDocumentos(docs);
      } else {
        setHistorial([]);
        setDocumentos([]);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [cartelId, canRead]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-ink/40 backdrop-blur-sm sm:items-center sm:p-4" role="presentation" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Expediente de ${cartelName}`} className="flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-white bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 pb-3 pt-4">
          <div className="min-w-0">
            <span className="section-kicker">Expediente</span>
            <h2 className="truncate font-display text-base font-extrabold text-ink">{expediente?.numero || cartelName}</h2>
          </div>
          <button onClick={onClose} className="icon-button grid" aria-label="Cerrar"><X size={18}/></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="grid min-h-40 place-items-center"><Loader2 size={22} className="animate-spin text-municipal-600"/></div>
          ) : !canRead ? (
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800"><Lock size={13} className="mt-0.5 shrink-0"/>Ingresá con tu cuenta municipal para ver el expediente.</p>
          ) : error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">No se pudo cargar el expediente. Reintentá más tarde.</p>
          ) : expediente ? (
            <ExpedienteView
              expediente={expediente}
              cartelName={cartelName}
              inspecciones={inspecciones}
              historial={historial}
              documentos={documentos}
              canManage={canManage}
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
function ExpedienteView({ expediente, cartelName, inspecciones, historial, documentos, canManage, busy, setBusy, onChanged }: {
  expediente: ExpedienteRecord; cartelName: string; inspecciones: InspectionRecord[];
  historial: ExpedienteHistoryEntry[]; documentos: ExpedienteDocumento[];
  canManage: boolean; busy: boolean; setBusy: (v: boolean) => void; onChanged: () => void;
}) {
  const config = getExpedienteState(expediente.estado);
  const [obs, setObs] = useState(expediente.observaciones ?? "");
  const [savedObs, setSavedObs] = useState(false);

  const saveObs = async () => {
    setBusy(true);
    const ok = await updateExpediente(expediente.id, { observaciones: obs.trim() || null });
    setBusy(false);
    if (ok) { setSavedObs(true); onChanged(); }
  };

  const transition = async (next: ExpedienteState) => {
    setBusy(true);
    const ok = await updateExpedienteEstado(expediente.id, next);
    setBusy(false);
    if (ok) onChanged();
  };

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    await uploadExpedienteDocumento(expediente.id, file, file.name);
    setBusy(false);
    onChanged();
  };

  return <div className="space-y-4">
    {/* Encabezado */}
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase text-white" style={{ background: config.color }}>{config.label}</span>
        <span className="text-[9px] font-bold text-slate-400">{expediente.numero}</span>
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
    <button type="button" onClick={() => printExpedienteDossier({ expediente, cartelName, inspecciones, historial })} className="secondary-button compact w-full justify-center"><Printer size={12}/>Exportar PDF (dossier)</button>

    {/* Transiciones */}
    <Transitions estado={expediente.estado} canManage={canManage} busy={busy} onTransition={transition}/>

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
          <span className="flex min-w-0 items-center gap-1.5"><FileText size={11} className="shrink-0 text-slate-400"/><span className="truncate">{doc.descripcion || doc.storagePath.split("/").pop()}</span></span>
          {doc.url && <a href={doc.url} target="_blank" rel="noreferrer" className="shrink-0 text-[9px] font-bold text-municipal-700 hover:text-municipal-900">Ver</a>}
        </li>
      ))}</ul>}
      {canManage ? (
        <label className="secondary-button compact inline-flex w-full cursor-pointer justify-center">
          <Paperclip size={12}/>Adjuntar documento
          <input type="file" accept="application/pdf,image/*" className="hidden" disabled={busy} onChange={(e) => onUpload(e.target.files?.[0])}/>
        </label>
      ) : documentos.length === 0 && <p className="text-[10px] text-slate-400">Sin documentos.</p>}
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
            <span className="flex flex-wrap items-center gap-1">{from && <><b className="font-semibold text-slate-400">{from.label}</b><ArrowRight size={9} className="text-slate-300"/></>}<b className="font-bold text-slate-700">{to.label}</b></span>
            <time className="ml-auto shrink-0 text-[9px] text-slate-400">{new Date(entry.createdAt).toLocaleDateString("es-AR")}</time>
          </li>;
        })}</ol>
      )}
    </Section>
  </div>;
}

function Transitions({ estado, canManage, busy, onTransition }: { estado: ExpedienteState; canManage: boolean; busy: boolean; onTransition: (next: ExpedienteState) => void }) {
  const config = getExpedienteState(estado);
  if (!canManage) {
    return <p className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[9px] font-semibold text-slate-500"><Lock size={11}/>Cambiar el estado requiere rol coordinador o administrador.</p>;
  }
  if (config.allowedNext.length === 0) {
    return <p className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[9px] font-semibold text-slate-500">Estado final: sin transiciones disponibles.</p>;
  }
  return <div>
    <span className="text-[8px] font-extrabold uppercase tracking-wider text-slate-400">Avanzar estado</span>
    <div className="mt-1.5 flex flex-wrap gap-1.5">{config.allowedNext.filter((next) => canTransition(estado, next)).map((next) => {
      const target = getExpedienteState(next);
      return <button key={next} type="button" disabled={busy} onClick={() => onTransition(next)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[9px] font-bold text-slate-600 transition hover:border-municipal-300 hover:text-municipal-700 disabled:opacity-50">
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
    <div className="mb-1.5 flex items-center gap-1.5 text-[9px] font-extrabold uppercase tracking-wider text-slate-400">{icon}{title}</div>
    {children}
  </div>;
}
