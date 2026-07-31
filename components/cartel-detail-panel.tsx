"use client";

import { useEffect, useRef, useState } from "react";
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
  X,
} from "lucide-react";
import type { AnalyzedCartel } from "@/data/territorial";
import {
  analysisColors,
  analysisLabels,
} from "@/data/territorial";
import type { TerritorialLinkStatus } from "@/data/carteles";
import type { StateChangeRequest } from "@/data/approvals";
import { getInspectionState, type InspectionState } from "@/data/inspections";
import { useAuth, type AuthState } from "@/hooks/use-auth";
import {
  loadStateChangeRequests,
  requestInspectionStateChange,
  resolveStateChangeRequest,
} from "@/lib/approval-repository";
import {
  requestCartelTerritorialLink,
} from "@/lib/cartel-repository";
import {
  loadInspectionHistory,
  loadInspectionPhotos,
  loadInspectionsByCartel,
  type InspectionHistoryEntry,
  type InspectionPhoto,
  type InspectionRecord,
} from "@/lib/inspection-repository";
import { AuthPanel } from "./auth-panel";
import { InspectionForm } from "./inspection-form";
import { ExpedientePanel } from "./expediente-panel";
import { PhotoLightbox } from "./photo-lightbox";
import { RegisterCartelForm } from "./register-cartel-form";
import { StateChangeApprovals } from "./state-change-approvals";
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
  const [localLinkStatus, setLocalLinkStatus] = useState<TerritorialLinkStatus | null>(null);
  const [activityKey, setActivityKey] = useState(0);
  const { open, close } = useDismissible(onClose, 300);
  const auth = useAuth();
  const previousUserId = useRef<string | null>(auth.user?.id ?? null);
  const recordId = cartel.properties.administrative?.recordId ?? localRecordId;
  const linkStatus = cartel.properties.administrative?.linkStatus
    ?? localLinkStatus
    ?? "sin_vinculo";
  const operationalRecordId = linkStatus === "aprobado" ? recordId : null;
  const googleMapsEmbedKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY;
  const [longitude, latitude] = cartel.geometry.coordinates;
  const properties = cartel.properties;
  const visualStatus = properties.analysisStatus;
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

  // Cerrar y purgar cualquier vista administrativa cuando se pierde la sesión.
  // Esto también desmonta formularios que podrían conservar empresa/CUIT.
  useEffect(() => {
    const currentUserId = auth.user?.id ?? null;
    const ownerChanged = previousUserId.current !== null
      && previousUserId.current !== currentUserId;
    previousUserId.current = currentUserId;
    if (!ownerChanged) return;
    setShowForm(false);
    setShowExpediente(false);
    setPendingForm(false);
    setShowRegister(false);
    setLocalRecordId(null);
    setLocalLinkStatus(null);
    setActivityKey((value) => value + 1);
  }, [auth.user?.id]);

  // El panel se reusa al seleccionar otro cartel: el vínculo local no debe arrastrarse.
  useEffect(() => {
    setLocalRecordId(null);
    setLocalLinkStatus(null);
    setShowRegister(false);
  }, [cartel.properties.id]);

  // Usuario autenticado pero sin rol operativo: puede consultar, no inspeccionar.
  const loggedInNoRole = auth.available && Boolean(auth.user) && !auth.canInspect;

  const handleStartInspection = () => {
    if (!operationalRecordId || loggedInNoRole) return;
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
    if (!auth.user || !auth.canInspect) return;
    setShowRegister(true);
  };

  const handleRegistered = (
    newRecordId: string,
    _alreadyExisted: boolean,
    newLinkStatus: TerritorialLinkStatus,
  ) => {
    setShowRegister(false);
    setLocalRecordId(newRecordId);
    setLocalLinkStatus(newLinkStatus);
    window.dispatchEvent(new Event("carteleria:administrative-refresh"));
  };

  return <aside role="dialog" aria-modal="false" aria-label="Ficha operativa del cartel" data-state={open ? "open" : "closed"} className="absolute inset-x-2 bottom-2 z-[600] max-h-[82%] overflow-y-auto rounded-2xl border border-white bg-white/95 shadow-2xl backdrop-blur transition-[transform,opacity] duration-300 ease-out will-change-transform data-[state=closed]:translate-y-6 data-[state=closed]:opacity-0 sm:inset-x-auto sm:bottom-auto sm:right-5 sm:top-5 sm:max-h-[calc(100%-2.5rem)] sm:w-[min(430px,calc(100%-40px))] sm:data-[state=closed]:translate-x-8 sm:data-[state=closed]:translate-y-0">
    <header className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 px-4 pb-3 pt-4 backdrop-blur sm:px-5">
      <button onClick={close} className="absolute right-3 top-3 grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-municipal-500" aria-label="Cerrar ficha"><X size={17}/></button>
      <div className="flex items-center gap-2 pr-10">
        <span className="badge-soft"><i style={{ background: analysisColors[visualStatus] }}/>{analysisLabels[visualStatus]}</span>
        <span className="text-micro font-bold text-slate-400">ID {properties.id}</span>
        {recordId && <span className={`rounded-full px-2 py-1 text-micro font-extrabold ${linkStatus === "aprobado" ? "bg-blue-50 text-blue-700" : linkStatus === "pendiente" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{linkStatus === "aprobado" ? "Vínculo aprobado" : linkStatus === "pendiente" ? "Vínculo pendiente" : "Sin vínculo aprobado"}</span>}
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
      {activeTab === "actividad" && <ActivityTab key={`${operationalRecordId ?? "none"}-${auth.user?.id ?? "anonymous"}`} cartelId={operationalRecordId} cartelName={cartel.properties.name || "Cartel relevado"} refreshKey={activityKey} authReady={auth.canRead} canWrite={Boolean(operationalRecordId) && auth.canInspect} auth={auth}/>}

      {recordId && linkStatus !== "aprobado" && (
        <TerritorialLinkApproval
          recordId={recordId}
          territorialFeatureId={String(cartel.properties.id)}
          status={linkStatus}
          canRequest={auth.canInspect}
          onResolved={setLocalLinkStatus}
        />
      )}

      {streetPreview && <StreetPreview title={properties.name || "cartel relevado"} embedUrl={streetEmbedUrl} onClose={() => setStreetPreview(false)}/>}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <a href={mapsUrl} target="_blank" rel="noreferrer" className="secondary-button compact justify-center"><Navigation size={12}/>Google Maps</a>
        <button onClick={() => setStreetPreview((value) => !value)} className="secondary-button compact justify-center"><Camera size={12}/>{streetPreview ? "Cerrar vista" : "Street View"}</button>
      </div>
      {streetPreview && <a href={streetUrl} target="_blank" rel="noreferrer" className="secondary-button compact mt-2 w-full justify-center">Abrir en Google Street <ExternalLink size={12}/></a>}

      <div className="mt-4 border-t border-slate-100 pt-4">
        {auth.available && auth.user && auth.roleError ? (
          <div className="rounded-xl bg-red-50 p-3 text-center">
            <p className="text-[10px] font-semibold text-red-700">{auth.roleError} Las acciones quedan bloqueadas.</p>
            <button type="button" onClick={() => void auth.retryRole()} className="secondary-button compact mt-2 justify-center">Reintentar permisos</button>
          </div>
        ) : recordId && !operationalRecordId ? (
          <>
            <button type="button" disabled className="primary-button w-full justify-center disabled:cursor-not-allowed disabled:opacity-55"><Lock size={15}/>Iniciar inspección · Vínculo no aprobado</button>
            <p className="mt-1.5 text-center text-[9px] font-semibold text-slate-400">Las inspecciones y expedientes se habilitan cuando un administrador aprueba el vínculo territorial.</p>
          </>
        ) : !recordId ? (
          auth.available && auth.canInspect ? (
            <>
              <button type="button" onClick={handleStartRegister} className="primary-button w-full justify-center"><BadgePlus size={15}/>Registrar este cartel</button>
              <p className="mt-1.5 text-center text-[9px] font-semibold text-slate-400">Crea el registro administrativo y habilita inspecciones y expediente.</p>
            </>
          ) : auth.available && auth.user ? (
            <p className="rounded-xl bg-slate-100 p-3 text-center text-[10px] font-semibold text-slate-600">
              Tu cuenta tiene acceso de solo lectura. El alta de registros requiere un rol operativo.
            </p>
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
          {operationalRecordId ? (
            <button type="button" onClick={() => setShowExpediente(true)} className="secondary-button compact justify-center"><FileText size={12}/>Expediente</button>
          ) : (
            <button type="button" disabled title="Disponible cuando el vínculo territorial esté aprobado" className="secondary-button compact justify-center disabled:cursor-not-allowed disabled:opacity-50"><FileText size={12}/>Expediente</button>
          )}
        </div>
      </div>
    </div>

    {showAuth && <AuthPanel auth={auth} onClose={() => { setShowAuth(false); setPendingForm(false); }}/>}
    {showRegister && !recordId && Boolean(auth.user) && auth.canInspect && (
      <RegisterCartelForm cartel={cartel} onClose={() => setShowRegister(false)} onRegistered={handleRegistered}/>
    )}
    {showForm && operationalRecordId && (
      <InspectionForm
        cartelId={operationalRecordId}
        cartelName={cartel.properties.name || "Cartel relevado"}
        prefill={{ empresa: cartel.properties.administrative?.empresa, cuit: cartel.properties.administrative?.cuit }}
        auth={auth}
        onClose={() => setShowForm(false)}
        onSaved={handleSaved}
      />
    )}
    {showExpediente && operationalRecordId && (
      <ExpedientePanel
        key={`${operationalRecordId}-${auth.user?.id ?? "anonymous"}`}
        cartelId={operationalRecordId}
        cartelName={cartel.properties.name || "Cartel relevado"}
        prefill={{
          empresa: cartel.properties.administrative?.empresa,
          direccion: [cartel.properties.administrative?.domicilio, cartel.properties.administrative?.numero].filter(Boolean).join(" ") || null,
        }}
        auth={auth}
        canMutate={Boolean(operationalRecordId)}
        onClose={() => setShowExpediente(false)}
      />
    )}
  </aside>;
}

function TerritorialLinkApproval({
  recordId,
  territorialFeatureId,
  status,
  canRequest,
  onResolved,
}: {
  recordId: string;
  territorialFeatureId: string;
  status: TerritorialLinkStatus;
  canRequest: boolean;
  onResolved: (status: TerritorialLinkStatus) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const operationInFlight = useRef(false);

  const requestAgain = async () => {
    if (operationInFlight.current || reason.trim().length < 5) return;
    operationInFlight.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const ok = await requestCartelTerritorialLink(
        recordId,
        territorialFeatureId,
        reason.trim(),
      );
      if (ok) {
        setReason("");
        onResolved("pendiente");
        window.dispatchEvent(new Event("carteleria:administrative-refresh"));
      } else {
        setFailed(true);
      }
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  };

  if (status === "rechazado") {
    return (
      <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-[10px] font-semibold leading-4 text-slate-700">
          El vínculo fue rechazado. El registro se conserva y puede volver a postularse con un nuevo fundamento.
        </p>
        {canRequest && (
          <>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} placeholder="Fundamento de la nueva solicitud (obligatorio)" className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[10px] text-slate-700 outline-none focus:border-municipal-500"/>
            <button type="button" disabled={busy || reason.trim().length < 5} onClick={requestAgain} className="mt-2 rounded-lg bg-municipal-700 px-2.5 py-1.5 text-[9px] font-extrabold text-white disabled:opacity-50">
              {busy ? "Procesando…" : "Volver a solicitar vínculo"}
            </button>
          </>
        )}
        {failed && <p role="alert" className="mt-1.5 text-[9px] font-semibold text-red-700">No se pudo volver a solicitar el vínculo.</p>}
      </div>
    );
  }

  if (status !== "pendiente") return null;

  return <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
    <p className="text-[10px] font-semibold leading-4 text-amber-900">
      El registro existe, pero el vínculo con este punto territorial espera aprobación administrativa.
    </p>
    <p className="mt-1.5 text-[9px] font-semibold text-amber-800">
      La resolución se realiza desde la bandeja de aprobaciones, donde se muestran
      el solicitante y su fundamento original.
    </p>
  </div>;
}

function SummaryTab({ cartel }: { cartel: AnalyzedCartel }) {
  const properties = cartel.properties;
  return <div className="space-y-3">
    {properties.administrative && <><SectionTitle icon={<Building2 size={14}/>} title="Registro administrativo"/><div className="grid grid-cols-2 gap-2"><DataCard label="Empresa" value={properties.administrative.empresa || "No informada"}/><DataCard label="CUIT" value={properties.administrative.cuit || "No informado"}/><DataCard label="Tipo y medida" value={[properties.administrative.tipoCartel, properties.administrative.dimensiones].filter(Boolean).join(" · ") || "Sin datos"}/><DataCard label="Superficie" value={properties.administrative.superficieM2 != null ? `${properties.administrative.superficieM2} m²` : "Sin datos"}/></div></>}
    <SectionTitle icon={<Ruler size={14}/>} title="Diagnóstico territorial"/>
    <DataCard label="Resultado geométrico" value={analysisLabels[properties.analysisStatus]}/>
    <p className="rounded-xl bg-slate-50 p-3 text-[10px] font-semibold leading-4 text-slate-500">
      Deuda, habilitación, registro, tipo de soporte y prioridad no se muestran
      hasta contar con una fuente administrativa oficial.
    </p>
    {properties.description && <div className="rounded-xl bg-slate-50 p-3"><span className="micro-label">Observaciones</span><p className="mt-1 text-[11px] leading-5 text-slate-600">{properties.description}</p></div>}
  </div>;
}

function TerritoryTab({ cartel }: { cartel: AnalyzedCartel }) {
  const properties = cartel.properties;
  const outside = properties.analysisStatus !== "dentro_corredor";
  return <div className="space-y-3">
    <SectionTitle icon={<MapPinned size={14}/>} title="Compatibilidad territorial"/>
    <dl className="space-y-3"><DataRow label="Resultado" value={analysisLabels[properties.analysisStatus]}/><DataRow label="Corredor más cercano" value={properties.nearestCorridor || "Sin referencia"}/><DataRow label="Distancia al corredor" value={formatDistance(properties.distanceToCorridorM)}/><DataRow label="Lugar permitido cercano" value={properties.nearestAllowedPlace || "Sin referencia"}/><DataRow label="Distancia al lugar" value={formatDistance(properties.distanceToAllowedPlaceM)}/></dl>
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
      setError(false);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(false);
    loadInspectionsByCartel(cartelId)
      .then((data) => { if (active) setInspections(data); })
      .catch(() => {
        if (active) {
          setInspections([]);
          setError(true);
        }
      })
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
    return <div className="space-y-2" aria-label="Cargando actividad">
      <div className="skeleton h-10 rounded-xl"/>
      <div className="skeleton h-20 rounded-2xl"/>
      <div className="skeleton h-20 rounded-2xl"/>
    </div>;
  }
  if (error) {
    return <div className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-red-200 bg-red-50 p-6 text-center"><div><History size={22} className="mx-auto text-red-300"/><b className="mt-3 block text-xs text-ink">No se pudo cargar la actividad</b><p className="mt-1 text-[10px] leading-4 text-slate-500">Reintentá más tarde o verificá tu sesión.</p></div></div>;
  }
  if (inspections.length === 0) {
    return <div className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center"><div><History size={24} className="mx-auto text-slate-300"/><b className="mt-3 block text-xs text-ink">Sin inspecciones registradas</b><p className="mt-1 text-[10px] leading-4 text-slate-500">{!cartelId ? "El historial estará disponible cuando el registro tenga un vínculo territorial aprobado." : authReady ? "Iniciá una inspección para comenzar el historial de este cartel." : "Ingresá con tu cuenta municipal para ver el historial de inspecciones."}</p></div></div>;
  }
  return <ul className="space-y-2">{inspections.map((inspection) => (
    <InspectionItem key={inspection.id} inspection={inspection} cartelName={cartelName} canWrite={canWrite} auth={auth} onStateChanged={handleStateChanged} onMutated={() => setMutationKey((value) => value + 1)}/>
  ))}</ul>;
}

function InspectionItem({ inspection, cartelName, canWrite, auth, onStateChanged, onMutated }: { inspection: InspectionRecord; cartelName: string; canWrite: boolean; auth: AuthState; onStateChanged: (id: string, estado: InspectionState) => void; onMutated: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailLoadError, setDetailLoadError] = useState<string | null>(null);
  const [history, setHistory] = useState<InspectionHistoryEntry[]>([]);
  const [photos, setPhotos] = useState<InspectionPhoto[]>([]);
  const [requests, setRequests] = useState<StateChangeRequest[]>([]);
  const [requestsLoadError, setRequestsLoadError] = useState<string | null>(null);
  const [detailRefreshKey, setDetailRefreshKey] = useState(0);
  const [pendingState, setPendingState] = useState<InspectionState | null>(null);
  const [transitionError, setTransitionError] = useState(false);
  const [editing, setEditing] = useState(false);
  const transitionInFlight = useRef(false);
  const config = getInspectionState(inspection.estado);

  useEffect(() => {
    if (!expanded) return;
    let active = true;
    setDetailLoading(true);
    setDetailLoadError(null);
    setRequestsLoadError(null);
    Promise.all([
      loadInspectionHistory(inspection.id),
      loadInspectionPhotos(inspection.id),
      loadStateChangeRequests("inspeccion", inspection.id),
    ])
      .then(([historyData, photoData, requestResult]) => {
        if (active) {
          setHistory(historyData);
          setPhotos(photoData);
          setRequests(requestResult.data);
          setRequestsLoadError(requestResult.ok ? null : requestResult.error);
          setDetailLoadError(null);
        }
      })
      .catch(() => {
        if (active) {
          setHistory([]);
          setPhotos([]);
          setRequests([]);
          setDetailLoadError("No se pudo verificar el historial o la evidencia.");
          setRequestsLoadError("No se pudo verificar el flujo de aprobaciones.");
        }
      })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [expanded, inspection.id, inspection.estado, detailRefreshKey]);

  const handleTransition = async (next: InspectionState, reason: string) => {
    if (requestsLoadError || transitionInFlight.current) return false;
    transitionInFlight.current = true;
    setPendingState(next);
    setTransitionError(false);
    try {
      const result = await requestInspectionStateChange(inspection.id, next, reason);
      if (!result.ok) {
        setTransitionError(true);
        return false;
      }
      if (result.outcome === "applied") {
        onStateChanged(inspection.id, next);
      }
      const refreshed = await loadStateChangeRequests("inspeccion", inspection.id);
      setRequests(refreshed.data);
      setRequestsLoadError(refreshed.ok ? null : refreshed.error);
      setDetailRefreshKey((value) => value + 1);
      return true;
    } catch {
      setTransitionError(true);
      return false;
    } finally {
      transitionInFlight.current = false;
      setPendingState(null);
    }
  };

  const handleResolveRequest = async (requestId: string, approve: boolean, note: string) => {
    if (requestsLoadError) return false;
    const request = requests.find((item) => item.id === requestId);
    const ok = await resolveStateChangeRequest(requestId, approve, note);
    if (ok) {
      const refreshed = await loadStateChangeRequests("inspeccion", inspection.id);
      setRequests(refreshed.data);
      setRequestsLoadError(refreshed.ok ? null : refreshed.error);
      if (approve && request?.entity === "inspeccion") {
        onStateChanged(inspection.id, request.requestedState);
      }
      window.dispatchEvent(new Event("carteleria:administrative-refresh"));
      onMutated();
    }
    return ok;
  };

  return <li className="overflow-hidden rounded-xl border border-slate-100 bg-white">
    <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} className="flex w-full items-center justify-between gap-2 p-3 text-left">
      <span className="badge-soft"><i style={{ background: config.color }}/>{config.label}</span>
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
        <div className="space-y-2 py-1" aria-label="Cargando detalle">
          <div className="skeleton h-14 rounded-xl"/>
          <div className="skeleton h-8 rounded-lg"/>
        </div>
      ) : detailLoadError ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-[10px] font-semibold text-red-700">{detailLoadError} Reintentá cerrando y abriendo este detalle.</p>
      ) : (
        <div className="space-y-3">
          <InspectionPhotos photos={photos}/>
          <InspectionHistory history={history}/>
          <StateChangeApprovals requests={requests} isAdmin={auth.role === "administrador"} loadError={requestsLoadError} onResolve={handleResolveRequest}/>
          <InspectionTransitions current={inspection.estado} canWrite={canWrite} isAdmin={auth.role === "administrador"} hasPendingRequest={requests.some((request) => request.status === "pendiente")} approvalLoadError={requestsLoadError} pendingState={pendingState} error={transitionError} onTransition={handleTransition}/>
          {canWrite && (
            <div className="border-t border-slate-200/70 pt-2.5">
              <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[9px] font-bold text-slate-600 transition hover:border-municipal-300 hover:text-municipal-700"><Pencil size={10}/>Editar datos</button>
              <p className="mt-1.5 text-[9px] text-slate-400">La actuación y su evidencia se conservan en la bitácora administrativa.</p>
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
  const historicalCount = photos.filter(
    (photo) => !photo.sha256 || !photo.byteSize || !photo.mimeType || !photo.uploadedBy,
  ).length;
  return <div>
    <span className="micro-label">Evidencia</span>
    {historicalCount > 0 && (
      <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1.5 text-[9px] font-semibold text-amber-800">
        {historicalCount} {historicalCount === 1 ? "archivo histórico no verificado" : "archivos históricos no verificados"}:
        no cuentan con huella y metadatos de integridad.
      </p>
    )}
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
    <span className="micro-label">Historial de estados</span>
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
            {entry.changedByName && <span className="text-[9px] text-slate-400">· {entry.changedByName}{entry.changedByRole ? ` (${entry.changedByRole})` : ""}</span>}
          </span>
          <time className="ml-auto shrink-0 text-[9px] text-slate-400">{new Date(entry.createdAt).toLocaleDateString("es-AR")}</time>
        </li>;
      })}</ol>
    )}
  </div>;
}

function InspectionTransitions({ current, canWrite, isAdmin, hasPendingRequest, approvalLoadError, pendingState, error, onTransition }: { current: InspectionState; canWrite: boolean; isAdmin: boolean; hasPendingRequest: boolean; approvalLoadError: string | null; pendingState: InspectionState | null; error: boolean; onTransition: (next: InspectionState, reason: string) => Promise<boolean> }) {
  const [reason, setReason] = useState("");
  const config = getInspectionState(current);
  const allowedNext = config.allowedNext;

  if (!canWrite) {
    return <p className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1.5 text-[9px] font-semibold text-slate-500"><Lock size={11}/>Ingresá con rol operativo para cambiar el estado.</p>;
  }
  if (approvalLoadError) {
    return <p className="rounded-lg bg-red-50 px-2 py-1.5 text-[9px] font-semibold text-red-700">No se habilitan transiciones porque no se pudo verificar si existen solicitudes pendientes.</p>;
  }
  if (allowedNext.length === 0) {
    return <p className="rounded-lg bg-slate-100 px-2 py-1.5 text-[9px] font-semibold text-slate-500">Estado final: sin transiciones disponibles.</p>;
  }
  if (hasPendingRequest) {
    return <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[9px] font-semibold text-amber-800">Hay una solicitud pendiente. Debe resolverse antes de pedir otro cambio.</p>;
  }
  return <div>
    <span className="micro-label">{isAdmin ? "Aplicar estado con aprobación" : "Solicitar cambio de estado"}</span>
    <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} placeholder="Fundamento obligatorio" className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[10px] text-slate-700 outline-none focus:border-municipal-500"/>
    <div className="mt-1.5 flex flex-wrap gap-1.5">{allowedNext.map((next) => {
      const target = getInspectionState(next);
      const isPending = pendingState === next;
      return <button key={next} type="button" disabled={pendingState !== null || reason.trim().length < 5} onClick={async () => { if (await onTransition(next, reason.trim())) setReason(""); }} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[9px] font-bold text-slate-600 transition hover:border-municipal-300 hover:text-municipal-700 disabled:cursor-not-allowed disabled:opacity-50">
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
  return <div className="rounded-xl bg-slate-50 p-3"><span className="micro-label">{label}</span><b className="mt-1 block text-[11px] capitalize leading-4 text-slate-700">{value}</b></div>;
}

function DataRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-2 text-[10px]"><dt className="font-semibold text-slate-400">{label}</dt><dd className="max-w-[58%] text-right font-bold text-slate-700">{value}</dd></div>;
}

function formatDistance(value: unknown) {
  const distance = Number(value);
  return Number.isFinite(distance) ? `${Math.round(distance)} metros` : "Sin datos";
}
