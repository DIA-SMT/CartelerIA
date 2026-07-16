"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowRight,
  BadgePlus,
  Building2,
  Camera,
  ChevronDown,
  ExternalLink,
  FileText,
  History,
  ImageOff,
  Loader2,
  Lock,
  MapPinned,
  Navigation,
  Pencil,
  Plus,
  Ruler,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type { AnalyzedCartel } from "@/data/territorial";
import {
  administrativeColors,
  administrativeLabels,
  analysisLabels,
  getAdministrativeVisualStatus,
} from "@/data/territorial";
import { getInspectionState, type InspectionState } from "@/data/inspections";
import { useAuth, type AuthState } from "@/hooks/use-auth";
import {
  deleteInspection,
  loadInspectionHistory,
  loadInspectionPhotos,
  loadInspectionsByCartel,
  updateInspectionState,
  type InspectionHistoryEntry,
  type InspectionPhoto,
  type InspectionRecord,
} from "@/lib/inspection-repository";
import { AuthPanel } from "./auth-panel";
import { InspectionForm } from "./inspection-form";
import { ExpedientePanel } from "./expediente-panel";
import { PhotoLightbox } from "./photo-lightbox";
import { RegisterCartelForm } from "./register-cartel-form";
import { useDismissible } from "@/hooks/use-dismissible";

type DetailTab = "resumen" | "territorio" | "actividad";

type Props = {
  cartel: AnalyzedCartel;
  onClose: () => void;
};

export function CartelDetailPanel({ cartel, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<DetailTab>("resumen");
  const [streetPreview, setStreetPreview] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showExpediente, setShowExpediente] = useState(false);
  const [pendingForm, setPendingForm] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  /** Vínculo creado desde esta ficha (registro recién dado de alta), sin recargar. */
  const [localRecordId, setLocalRecordId] = useState<string | null>(null);
  const [activityKey, setActivityKey] = useState(0);
  const { open, close } = useDismissible(onClose, 300);
  const auth = useAuth();
  const recordId = cartel.properties.administrative?.recordId ?? localRecordId;
  const googleMapsEmbedKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY;
  const [longitude, latitude] = cartel.geometry.coordinates;
  const properties = cartel.properties;
  const visualStatus = getAdministrativeVisualStatus(cartel);
  const mapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
  const streetUrl = `https://www.google.com/maps?q=&layer=c&cbll=${latitude},${longitude}`;
  const streetEmbedUrl = googleMapsEmbedKey
    ? `https://www.google.com/maps/embed/v1/streetview?key=${encodeURIComponent(googleMapsEmbedKey)}&location=${latitude},${longitude}&radius=100&source=outdoor`
    : null;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  useEffect(() => {
    if (pendingForm && auth.user) {
      setPendingForm(false);
      setShowAuth(false);
      setShowForm(true);
    }
  }, [pendingForm, auth.user]);

  // El panel se reusa al seleccionar otro cartel: el vínculo local no debe arrastrarse.
  useEffect(() => {
    setLocalRecordId(null);
    setShowRegister(false);
  }, [cartel.properties.id]);

  // Usuario autenticado pero sin rol operativo: puede consultar, no inspeccionar.
  const loggedInNoRole = auth.available && Boolean(auth.user) && !auth.canInspect;

  const handleStartInspection = () => {
    if (!recordId || loggedInNoRole) return;
    if (auth.available && !auth.user) {
      setPendingForm(true);
      setShowAuth(true);
      return;
    }
    setShowForm(true);
  };

  const handleSaved = () => {
    setShowForm(false);
    setActivityKey((value) => value + 1);
    setActiveTab("actividad");
  };

  // Solo se ofrece con sesión activa (el botón queda deshabilitado sin login).
  const handleStartRegister = () => {
    if (!auth.user) return;
    setShowRegister(true);
  };

  const handleRegistered = (newRecordId: string) => {
    setShowRegister(false);
    setLocalRecordId(newRecordId);
  };

  return <aside role="dialog" aria-modal="false" aria-label="Ficha operativa del cartel" data-state={open ? "open" : "closed"} className="absolute inset-x-2 bottom-2 z-[600] max-h-[82%] overflow-y-auto rounded-2xl border border-white bg-white/95 shadow-2xl backdrop-blur transition-[transform,opacity] duration-300 ease-out will-change-transform data-[state=closed]:translate-y-6 data-[state=closed]:opacity-0 sm:inset-x-auto sm:bottom-auto sm:right-5 sm:top-5 sm:max-h-[calc(100%-2.5rem)] sm:w-[min(430px,calc(100%-40px))] sm:data-[state=closed]:translate-x-8 sm:data-[state=closed]:translate-y-0">
    <header className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 px-4 pb-3 pt-4 backdrop-blur sm:px-5">
      <button onClick={close} className="absolute right-3 top-3 grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-municipal-500" aria-label="Cerrar ficha"><X size={17}/></button>
      <div className="flex items-center gap-2 pr-10">
        <span className="inline-flex rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase text-white" style={{ background: administrativeColors[visualStatus] }}>{administrativeLabels[visualStatus]}</span>
        <span className="text-[9px] font-bold text-slate-400">ID {properties.id}</span>
        {(properties.administrative || localRecordId) && <span className="rounded-full bg-blue-50 px-2 py-1 text-[8px] font-extrabold text-blue-700">Registro vinculado</span>}
      </div>
      <h3 className="mt-2 pr-8 font-display text-lg font-extrabold leading-tight text-ink">{properties.name || "Cartel relevado"}</h3>
      <p className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold text-slate-500"><MapPinned size={12}/>{latitude.toFixed(6)}, {longitude.toFixed(6)}</p>
      <nav aria-label="Secciones de la ficha" className="mt-3 grid grid-cols-3 rounded-xl bg-slate-100 p-1">
        <TabButton active={activeTab === "resumen"} onClick={() => setActiveTab("resumen")}>Resumen</TabButton>
        <TabButton active={activeTab === "territorio"} onClick={() => setActiveTab("territorio")}>Territorio</TabButton>
        <TabButton active={activeTab === "actividad"} onClick={() => setActiveTab("actividad")}>Actividad</TabButton>
      </nav>
    </header>

    <div className="p-4 sm:p-5">
      {activeTab === "resumen" && <SummaryTab cartel={cartel}/>}
      {activeTab === "territorio" && <TerritoryTab cartel={cartel}/>}
      {activeTab === "actividad" && <ActivityTab cartelId={recordId} cartelName={cartel.properties.name || "Cartel relevado"} refreshKey={activityKey} authReady={auth.available && Boolean(auth.user)} canWrite={auth.available && auth.canInspect} auth={auth}/>}

      {streetPreview && <StreetPreview title={properties.name || "cartel relevado"} embedUrl={streetEmbedUrl} onClose={() => setStreetPreview(false)}/>}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <a href={mapsUrl} target="_blank" rel="noreferrer" className="secondary-button compact justify-center"><Navigation size={12}/>Google Maps</a>
        <button onClick={() => setStreetPreview((value) => !value)} className="secondary-button compact justify-center"><Camera size={12}/>{streetPreview ? "Cerrar vista" : "Street View"}</button>
      </div>
      {streetPreview && <a href={streetUrl} target="_blank" rel="noreferrer" className="secondary-button compact mt-2 w-full justify-center">Abrir en Google Street <ExternalLink size={12}/></a>}

      <div className="mt-4 border-t border-slate-100 pt-4">
        {!recordId ? (
          auth.available && auth.user ? (
            <>
              <button type="button" onClick={handleStartRegister} className="primary-button w-full justify-center"><BadgePlus size={15}/>Registrar este cartel</button>
              <p className="mt-1.5 text-center text-[9px] font-semibold text-slate-400">Crea el registro administrativo y habilita inspecciones y expediente.</p>
            </>
          ) : auth.available ? (
            <>
              <button type="button" disabled title="Ingresá con tu cuenta municipal para registrar este cartel" className="primary-button w-full justify-center disabled:cursor-not-allowed disabled:opacity-55"><Lock size={15}/>Registrar este cartel · Requiere sesión</button>
              <p className="mt-1.5 text-center text-[9px] font-semibold text-slate-400">Ingresá con tu cuenta municipal (botón &ldquo;Ingresar&rdquo; del encabezado) para registrarlo.</p>
            </>
          ) : (
            <button type="button" disabled title="Disponible para carteles vinculados con el registro administrativo" className="primary-button w-full justify-center disabled:cursor-not-allowed disabled:opacity-55"><ShieldCheck size={15}/>Iniciar inspección · Requiere registro vinculado</button>
          )
        ) : loggedInNoRole ? (
          <>
            <button type="button" disabled title="Tu rol es de consulta: no permite registrar inspecciones" className="primary-button w-full justify-center disabled:cursor-not-allowed disabled:opacity-55"><Lock size={15}/>Iniciar inspección · Requiere rol operativo</button>
            <p className="mt-1.5 text-center text-[9px] font-semibold text-slate-400">Tu cuenta tiene rol de consulta. Pedí a un administrador el rol de inspector para registrar inspecciones.</p>
          </>
        ) : (
          <button type="button" onClick={handleStartInspection} className="primary-button w-full justify-center"><Plus size={15}/>Iniciar inspección</button>
        )}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setActiveTab("actividad")} className="secondary-button compact justify-center"><History size={12}/>Ver historial</button>
          {recordId ? (
            <button type="button" onClick={() => setShowExpediente(true)} className="secondary-button compact justify-center"><FileText size={12}/>Expediente</button>
          ) : (
            <button type="button" disabled title="Disponible para carteles vinculados con el registro administrativo" className="secondary-button compact justify-center disabled:cursor-not-allowed disabled:opacity-50"><FileText size={12}/>Expediente</button>
          )}
        </div>
      </div>
    </div>

    {showAuth && <AuthPanel auth={auth} onClose={() => { setShowAuth(false); setPendingForm(false); }}/>}
    {showRegister && !recordId && Boolean(auth.user) && (
      <RegisterCartelForm cartel={cartel} onClose={() => setShowRegister(false)} onRegistered={handleRegistered}/>
    )}
    {showForm && recordId && (
      <InspectionForm
        cartelId={recordId}
        cartelName={cartel.properties.name || "Cartel relevado"}
        prefill={{ empresa: cartel.properties.administrative?.empresa, cuit: cartel.properties.administrative?.cuit }}
        auth={auth}
        onClose={() => setShowForm(false)}
        onSaved={handleSaved}
      />
    )}
    {showExpediente && recordId && (
      <ExpedientePanel
        cartelId={recordId}
        cartelName={cartel.properties.name || "Cartel relevado"}
        prefill={{
          empresa: cartel.properties.administrative?.empresa,
          direccion: [cartel.properties.administrative?.domicilio, cartel.properties.administrative?.numero].filter(Boolean).join(" ") || null,
        }}
        auth={auth}
        onClose={() => setShowExpediente(false)}
      />
    )}
  </aside>;
}

function SummaryTab({ cartel }: { cartel: AnalyzedCartel }) {
  const properties = cartel.properties;
  return <div className="space-y-3">
    {properties.administrative && <><SectionTitle icon={<Building2 size={14}/>} title="Registro administrativo"/><div className="grid grid-cols-2 gap-2"><DataCard label="Empresa" value={properties.administrative.empresa || "No informada"}/><DataCard label="CUIT" value={properties.administrative.cuit || "No informado"}/><DataCard label="Tipo y medida" value={[properties.administrative.tipoCartel, properties.administrative.dimensiones].filter(Boolean).join(" · ") || "Sin datos"}/><DataCard label="Superficie" value={properties.administrative.superficieM2 != null ? `${properties.administrative.superficieM2} m²` : "Sin datos"}/></div></>}
    <SectionTitle icon={<Building2 size={14}/>} title="Situación administrativa"/>
    <div className="grid grid-cols-2 gap-2">
      <DataCard label="Estado territorial" value={analysisLabels[properties.analysisStatus]}/>
      <DataCard label="Habilitación" value={humanize(properties.enablementStatus)}/>
      <DataCard label="Estado tributario" value={humanize(properties.taxStatus)}/>
      <DataCard label="Registro" value={humanize(properties.registryStatus)}/>
    </div>
    <SectionTitle icon={<Ruler size={14}/>} title="Características disponibles"/>
    <div className="grid grid-cols-2 gap-2">
      <DataCard label="Tipo de soporte" value={humanize(properties.supportType)}/>
      <DataCard label="Prioridad" value={humanize(properties.controlPriority)}/>
    </div>
    {properties.description && <div className="rounded-xl bg-slate-50 p-3"><span className="text-[8px] font-extrabold uppercase tracking-wider text-slate-400">Observaciones</span><p className="mt-1 text-[11px] leading-5 text-slate-600">{properties.description}</p></div>}
  </div>;
}

function TerritoryTab({ cartel }: { cartel: AnalyzedCartel }) {
  const properties = cartel.properties;
  const outside = properties.analysisStatus !== "dentro_corredor";
  return <div className="space-y-3">
    <SectionTitle icon={<MapPinned size={14}/>} title="Compatibilidad territorial"/>
    <dl className="space-y-3"><DataRow label="Resultado" value={analysisLabels[properties.analysisStatus]}/><DataRow label="Corredor más cercano" value={properties.nearestCorridor || "Sin referencia"}/><DataRow label="Distancia al corredor" value={formatDistance(properties.distanceToCorridorM)}/><DataRow label="Lugar permitido cercano" value={properties.nearestAllowedPlace || "Sin referencia"}/><DataRow label="Distancia al lugar" value={formatDistance(properties.distanceToAllowedPlaceM)}/><DataRow label="Zona sensible" value={properties.sensitiveZone ? "Sí · requiere revisión" : "No identificada"}/></dl>
    {outside && <p className="rounded-xl bg-amber-50 p-3 text-[10px] font-semibold leading-4 text-amber-800">Este resultado orienta la revisión territorial. No reemplaza la evaluación administrativa ni determina una infracción por sí solo.</p>}
  </div>;
}

function ActivityTab({ cartelId, cartelName, refreshKey, authReady, canWrite, auth }: { cartelId: string | null; cartelName: string; refreshKey: number; authReady: boolean; canWrite: boolean; auth: AuthState }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [inspections, setInspections] = useState<InspectionRecord[]>([]);
  /** Refresco interno tras editar o eliminar una inspección. */
  const [mutationKey, setMutationKey] = useState(0);

  useEffect(() => {
    if (!cartelId || !authReady) {
      setInspections([]);
      return;
    }
    let active = true;
    setLoading(true);
    setError(false);
    loadInspectionsByCartel(cartelId)
      .then((data) => { if (active) setInspections(data); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [cartelId, refreshKey, authReady, mutationKey]);

  // Actualización optimista: al cambiar el estado, refrescamos solo esa fila para
  // evitar el parpadeo de recargar toda la lista (el ítem expandido re-carga su
  // historial porque su effect depende de inspection.estado).
  const handleStateChanged = (id: string, estado: InspectionState) => {
    setInspections((current) => current.map((item) => (item.id === id ? { ...item, estado } : item)));
  };

  if (loading) {
    return <div className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center"><div><Loader2 size={22} className="mx-auto animate-spin text-municipal-600"/><p className="mt-3 text-[10px] text-slate-500">Cargando actividad...</p></div></div>;
  }
  if (error) {
    return <div className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-red-200 bg-red-50 p-6 text-center"><div><History size={22} className="mx-auto text-red-300"/><b className="mt-3 block text-xs text-ink">No se pudo cargar la actividad</b><p className="mt-1 text-[10px] leading-4 text-slate-500">Reintentá más tarde o verificá tu sesión.</p></div></div>;
  }
  if (inspections.length === 0) {
    return <div className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center"><div><History size={24} className="mx-auto text-slate-300"/><b className="mt-3 block text-xs text-ink">Sin inspecciones registradas</b><p className="mt-1 text-[10px] leading-4 text-slate-500">{authReady ? "Iniciá una inspección para comenzar el historial de este cartel." : "Ingresá con tu cuenta municipal para ver el historial de inspecciones."}</p></div></div>;
  }
  return <ul className="space-y-2">{inspections.map((inspection) => (
    <InspectionItem key={inspection.id} inspection={inspection} cartelName={cartelName} canWrite={canWrite} auth={auth} onStateChanged={handleStateChanged} onMutated={() => setMutationKey((value) => value + 1)}/>
  ))}</ul>;
}

function InspectionItem({ inspection, cartelName, canWrite, auth, onStateChanged, onMutated }: { inspection: InspectionRecord; cartelName: string; canWrite: boolean; auth: AuthState; onStateChanged: (id: string, estado: InspectionState) => void; onMutated: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [history, setHistory] = useState<InspectionHistoryEntry[]>([]);
  const [photos, setPhotos] = useState<InspectionPhoto[]>([]);
  const [pendingState, setPendingState] = useState<InspectionState | null>(null);
  const [transitionError, setTransitionError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const config = getInspectionState(inspection.estado);

  useEffect(() => {
    if (!expanded) return;
    let active = true;
    setDetailLoading(true);
    Promise.all([loadInspectionHistory(inspection.id), loadInspectionPhotos(inspection.id)])
      .then(([historyData, photoData]) => { if (active) { setHistory(historyData); setPhotos(photoData); } })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [expanded, inspection.id, inspection.estado]);

  const handleTransition = async (next: InspectionState) => {
    setPendingState(next);
    setTransitionError(false);
    const ok = await updateInspectionState(inspection.id, next);
    setPendingState(null);
    if (ok) onStateChanged(inspection.id, next);
    else setTransitionError(true);
  };

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(false);
    const ok = await deleteInspection(inspection.id);
    setDeleting(false);
    if (ok) onMutated();
    else setDeleteError(true);
  };

  return <li className="overflow-hidden rounded-xl border border-slate-100 bg-white">
    <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} className="flex w-full items-center justify-between gap-2 p-3 text-left">
      <span className="inline-flex rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase text-white" style={{ background: config.color }}>{config.label}</span>
      <span className="flex items-center gap-2">
        <time className="text-[9px] font-semibold text-slate-400">{new Date(inspection.createdAt).toLocaleDateString("es-AR")}</time>
        <ChevronDown size={14} className={`text-slate-400 transition ${expanded ? "rotate-180" : ""}`}/>
      </span>
    </button>

    <div className="px-3 pb-3">
      <div className="grid grid-cols-2 gap-1.5 text-[10px] text-slate-600">
        {inspection.empresa && <span><b className="text-slate-400">Empresa:</b> {inspection.empresa}</span>}
        {inspection.superficieM2 != null && <span><b className="text-slate-400">Superficie:</b> {inspection.superficieM2} m²</span>}
      </div>
      {inspection.observaciones && <p className="mt-1.5 rounded-lg bg-slate-50 px-2 py-1.5 text-[10px] leading-4 text-slate-500">{inspection.observaciones}</p>}
    </div>

    {expanded && <div className="border-t border-slate-100 bg-slate-50/60 p-3">
      {detailLoading ? (
        <div className="grid place-items-center py-4"><Loader2 size={18} className="animate-spin text-municipal-600"/></div>
      ) : (
        <div className="space-y-3">
          <InspectionPhotos photos={photos}/>
          <InspectionHistory history={history}/>
          <InspectionTransitions current={inspection.estado} canWrite={canWrite} pendingState={pendingState} error={transitionError} onTransition={handleTransition}/>
          {canWrite && (
            <div className="border-t border-slate-200/70 pt-2.5">
              {confirmDelete ? (
                <div className="rounded-lg bg-red-50 p-2.5">
                  <p className="text-[10px] font-bold text-red-800">¿Eliminar esta inspección definitivamente? Se borran también sus fotos y su historial.</p>
                  <div className="mt-2 flex gap-1.5">
                    <button type="button" disabled={deleting} onClick={handleDelete} className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1.5 text-[9px] font-extrabold text-white transition hover:bg-red-700 disabled:opacity-60">
                      {deleting ? <Loader2 size={10} className="animate-spin"/> : <Trash2 size={10}/>}Eliminar
                    </button>
                    <button type="button" disabled={deleting} onClick={() => setConfirmDelete(false)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[9px] font-bold text-slate-600">Cancelar</button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[9px] font-bold text-slate-600 transition hover:border-municipal-300 hover:text-municipal-700"><Pencil size={10}/>Editar</button>
                  <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1 rounded-lg border border-red-100 bg-white px-2.5 py-1.5 text-[9px] font-bold text-red-600 transition hover:border-red-300 hover:bg-red-50"><Trash2 size={10}/>Eliminar</button>
                </div>
              )}
              {deleteError && <p role="alert" className="mt-1.5 text-[9px] font-semibold text-red-600">No se pudo eliminar. Verificá tu sesión y permisos.</p>}
            </div>
          )}
        </div>
      )}
    </div>}

    {editing && (
      <InspectionForm
        cartelId={inspection.cartelId}
        cartelName={cartelName}
        auth={auth}
        existing={inspection}
        onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); onMutated(); }}
      />
    )}
  </li>;
}

function InspectionPhotos({ photos }: { photos: InspectionPhoto[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (photos.length === 0) return null;
  const viewable = photos.filter((photo) => photo.url);
  return <div>
    <span className="text-[8px] font-extrabold uppercase tracking-wider text-slate-400">Evidencia</span>
    <ul className="mt-1.5 grid grid-cols-3 gap-1.5">{photos.map((photo, index) => (
      <li key={photo.id} className="aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
        {photo.url
          ? <button type="button" onClick={() => setOpenIndex(viewable.findIndex((item) => item.id === photo.id))} className="block size-full cursor-zoom-in" aria-label={`Ampliar evidencia ${index + 1}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt={`Evidencia ${index + 1}`} className="size-full object-cover transition hover:scale-105" loading="lazy"/>
            </button>
          : <span className="grid size-full place-items-center text-slate-300" title="No se pudo cargar la imagen"><ImageOff size={16}/></span>}
      </li>
    ))}</ul>
    {openIndex !== null && (
      <PhotoLightbox
        photos={viewable.map((photo, index) => ({ url: photo.url as string, alt: `Evidencia ${index + 1}` }))}
        startIndex={openIndex}
        onClose={() => setOpenIndex(null)}
      />
    )}
  </div>;
}

function InspectionHistory({ history }: { history: InspectionHistoryEntry[] }) {
  return <div>
    <span className="text-[8px] font-extrabold uppercase tracking-wider text-slate-400">Historial de estados</span>
    {history.length === 0 ? (
      <p className="mt-1 text-[10px] text-slate-400">Sin cambios registrados.</p>
    ) : (
      <ol className="mt-1.5 space-y-1.5">{history.map((entry) => {
        const to = getInspectionState(entry.estadoNuevo);
        const from = entry.estadoAnterior ? getInspectionState(entry.estadoAnterior) : null;
        return <li key={entry.id} className="flex items-center gap-1.5 text-[10px] text-slate-600">
          <span className="size-1.5 shrink-0 rounded-full" style={{ background: to.color }}/>
          <span className="flex flex-wrap items-center gap-1">
            {from && <><b className="font-semibold text-slate-400">{from.label}</b><ArrowRight size={9} className="text-slate-300"/></>}
            <b className="font-bold text-slate-700">{to.label}</b>
          </span>
          <time className="ml-auto shrink-0 text-[9px] text-slate-400">{new Date(entry.createdAt).toLocaleDateString("es-AR")}</time>
        </li>;
      })}</ol>
    )}
  </div>;
}

function InspectionTransitions({ current, canWrite, pendingState, error, onTransition }: { current: InspectionState; canWrite: boolean; pendingState: InspectionState | null; error: boolean; onTransition: (next: InspectionState) => void }) {
  const config = getInspectionState(current);
  const allowedNext = config.allowedNext;

  if (!canWrite) {
    return <p className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1.5 text-[9px] font-semibold text-slate-500"><Lock size={11}/>Ingresá con rol operativo para cambiar el estado.</p>;
  }
  if (allowedNext.length === 0) {
    return <p className="rounded-lg bg-slate-100 px-2 py-1.5 text-[9px] font-semibold text-slate-500">Estado final: sin transiciones disponibles.</p>;
  }
  return <div>
    <span className="text-[8px] font-extrabold uppercase tracking-wider text-slate-400">Avanzar estado</span>
    <div className="mt-1.5 flex flex-wrap gap-1.5">{allowedNext.map((next) => {
      const target = getInspectionState(next);
      const isPending = pendingState === next;
      return <button key={next} type="button" disabled={pendingState !== null} onClick={() => onTransition(next)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[9px] font-bold text-slate-600 transition hover:border-municipal-300 hover:text-municipal-700 disabled:cursor-not-allowed disabled:opacity-50">
        {isPending ? <Loader2 size={10} className="animate-spin"/> : <span className="size-2 rounded-full" style={{ background: target.color }}/>}
        {target.label}
      </button>;
    })}</div>
    {error && <p role="alert" className="mt-1.5 text-[9px] font-semibold text-red-600">No se pudo cambiar el estado. Verificá tu sesión y permisos.</p>}
  </div>;
}

function StreetPreview({ title, embedUrl, onClose }: { title: string; embedUrl: string | null; onClose: () => void }) {
  return <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-100"><div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2"><b className="text-[10px] text-ink">Street View de esta ubicación</b><button onClick={onClose} className="text-[9px] font-bold text-slate-400 hover:text-municipal-700">Ocultar</button></div>{embedUrl ? <iframe title={`Street View de ${title}`} src={embedUrl} className="h-64 w-full border-0" loading="lazy" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/> : <div className="grid h-48 place-items-center px-6 text-center"><div><MapPinned size={26} className="mx-auto text-municipal-600"/><b className="mt-3 block text-xs text-ink">Falta habilitar Google Street View</b><p className="mt-1 text-[10px] leading-4 text-slate-500">Configurá la clave de Maps Embed API para cargar la fotografía panorámica.</p></div></div>}</div>;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`rounded-lg px-2 py-2 text-[9px] font-extrabold transition ${active ? "bg-white text-municipal-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{children}</button>;
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return <div className="flex items-center gap-2 pt-1 text-[9px] font-extrabold uppercase tracking-wider text-slate-400">{icon}{title}</div>;
}

function DataCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-slate-50 p-3"><span className="text-[8px] font-extrabold uppercase tracking-wider text-slate-400">{label}</span><b className="mt-1 block text-[11px] capitalize leading-4 text-slate-700">{value}</b></div>;
}

function DataRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-2 text-[10px]"><dt className="font-semibold text-slate-400">{label}</dt><dd className="max-w-[58%] text-right font-bold text-slate-700">{value}</dd></div>;
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

function formatDistance(value: unknown) {
  const distance = Number(value);
  return Number.isFinite(distance) ? `${Math.round(distance)} metros` : "Sin datos";
}
