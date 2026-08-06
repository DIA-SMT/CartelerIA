"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, FileText, History, Loader2, RefreshCw, Save, Table2 } from "lucide-react";
import type { AnalyzedCartel } from "@/data/territorial";
import { useAuth } from "@/hooks/use-auth";
import {
  ESTADO_ARTICULO_COLORS,
  ESTADO_ARTICULO_LABELS,
  MOTIVO_MIN_LENGTH,
  ORIGEN_ARTICULO_LABELS,
  cambiarEstadoArticulo,
  guardarArticulo,
  loadArticulos,
  loadObservacionesDelProyecto,
  loadProyectoActivo,
  type ArticuloNorma,
  type EstadoArticulo,
  type ProyectoNorma,
} from "@/lib/fabrica-repository";
import { agruparObservaciones, exportarObservacionesXlsx } from "@/lib/norma-export";
import { ConfirmDialog } from "../confirm-dialog";
import { toast } from "../toaster";
import { ArticuladoCompleto } from "./articulado-completo";
import { HistorialArticulo } from "./historial-articulo";
import { ObservacionesArticulo } from "./observaciones-articulo";
import { PanelDiagnostico } from "./panel-diagnostico";

type LoadPhase = "idle" | "loading" | "ready" | "error";

type CambioPendiente = {
  articulo: ArticuloNorma;
  estado: EstadoArticulo;
  fundamento: string;
};

/** Transiciones ofrecidas desde cada estado. Descartar sale de cualquiera. */
const SIGUIENTES: Record<EstadoArticulo, EstadoArticulo[]> = {
  propuesto: ["en_revision", "descartado"],
  en_revision: ["aprobado", "propuesto", "descartado"],
  aprobado: ["en_revision"],
  descartado: ["propuesto"],
};

/**
 * Lee el artículo abierto del hash: `#fabrica?articulo=<uuid>`.
 *
 * Mismo mecanismo que las pestañas de Configuración, y por la misma razón: si
 * el artículo no está en la URL, cualquier ida y vuelta —recargar, ir al mapa a
 * ver los carteles que no cumplen, mandarle el enlace a alguien— te devuelve a
 * la lista y hay que buscarlo de nuevo entre treinta y tres.
 */
function articuloDelHash(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  if (!hash.startsWith("#fabrica")) return null;
  const separador = hash.indexOf("?");
  if (separador === -1) return null;
  return new URLSearchParams(hash.slice(separador + 1)).get("articulo");
}

/**
 * `replaceState` y no `location.hash`: asignar el hash volvería a scrollear a la
 * sección y el foco saltaría del editor. Es el mismo cuidado que en las
 * pestañas de Configuración.
 */
function escribirHash(articuloId: string | null) {
  const destino = articuloId ? `#fabrica?articulo=${articuloId}` : "#fabrica";
  if (window.location.hash === destino) return;
  window.history.replaceState(null, "", destino);
}

/**
 * Fábrica Normativa: la mesa donde se escribe la nueva ordenanza.
 *
 * La persona es la autora y el sistema asiste. De ahí que nada se sobrescriba
 * —cada guardado agrega una versión—, que los estados se muevan con fundamento
 * y que el texto del borrador recibido quede siempre a la vista para poder
 * explicar por qué se cambió.
 */
export default function Fabrica({
  onVolver,
  carteles,
  onVerEnMapa,
}: {
  onVolver: () => void;
  /** Capas ya cargadas por el dashboard: no se vuelven a pedir. */
  carteles: AnalyzedCartel[];
  onVerEnMapa: (ids: string[]) => void;
}) {
  const auth = useAuth();
  const puedeEscribir = auth.canInspect;

  const [proyecto, setProyecto] = useState<ProyectoNorma | null>(null);
  const [articulos, setArticulos] = useState<ArticuloNorma[]>([]);
  // Arranca con lo que diga la URL, incluso antes de saber si ese artículo
  // existe: los artículos tardan en llegar y perder la intención mientras tanto
  // es justamente el bug que se está arreglando.
  const [seleccionId, setSeleccionId] = useState<string | null>(articuloDelHash);
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataOwnerId, setDataOwnerId] = useState<string | null>(null);

  const [texto, setTexto] = useState("");
  const [sumilla, setSumilla] = useState("");
  const [motivo, setMotivo] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [cambio, setCambio] = useState<CambioPendiente | null>(null);
  const [historialDe, setHistorialDe] = useState<ArticuloNorma | null>(null);
  const [verArticulado, setVerArticulado] = useState(false);
  const [exportando, setExportando] = useState(false);
  const refreshSequence = useRef(0);
  const botonActivoRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setLoadPhase("loading");
    setDataOwnerId(null);

    const proyectoResult = await loadProyectoActivo();
    if (sequence !== refreshSequence.current) return;
    // El dueño se marca ANTES de cualquier salida: si no, un fallo de carga
    // dejaba `ownsData` en false y la pantalla mostraba el esqueleto para
    // siempre, sin decir nunca que algo había fallado.
    setDataOwnerId(auth.user?.id ?? null);

    if (!proyectoResult.ok) {
      setProyecto(null);
      setArticulos([]);
      setLoadError(proyectoResult.error);
      setLoadPhase("error");
      return;
    }
    if (!proyectoResult.data) {
      setProyecto(null);
      setArticulos([]);
      setLoadError(null);
      setLoadPhase("ready");
      return;
    }

    const articulosResult = await loadArticulos(proyectoResult.data.id);
    if (sequence !== refreshSequence.current) return;
    setProyecto(proyectoResult.data);
    setArticulos(articulosResult.data);
    setLoadError(articulosResult.ok ? null : articulosResult.error);
    setLoadPhase(articulosResult.ok ? "ready" : "error");
  }, [auth.user?.id]);

  useEffect(() => {
    void refresh();
    return () => { refreshSequence.current += 1; };
  }, [refresh]);

  /** Único camino para abrir un artículo: estado y URL se mueven juntos. */
  const seleccionar = useCallback((articuloId: string | null) => {
    setSeleccionId(articuloId);
    escribirHash(articuloId);
  }, []);

  // La URL también manda desde afuera: el botón de atrás del navegador, un
  // enlace pegado, o el ítem del menú que vuelve a `#fabrica` pelado.
  useEffect(() => {
    const sincronizar = () => setSeleccionId(articuloDelHash());
    window.addEventListener("hashchange", sincronizar);
    return () => window.removeEventListener("hashchange", sincronizar);
  }, []);

  const seleccionado = articulos.find((articulo) => articulo.id === seleccionId) ?? null;

  // Un id que no existe —artículo borrado, enlace viejo, dedazo en la URL— se
  // limpia recién cuando el articulado terminó de cargar. Hacerlo antes
  // descartaría una selección válida solo por llegar primero.
  useEffect(() => {
    if (loadPhase !== "ready" || seleccionId === null || articulos.length === 0) return;
    if (!articulos.some((articulo) => articulo.id === seleccionId)) {
      setSeleccionId(null);
      escribirHash(null);
    }
  }, [loadPhase, seleccionId, articulos]);

  // Abrir un artículo carga su texto vigente en el editor y limpia el motivo:
  // arrastrar el motivo del artículo anterior sería asentar un fundamento que
  // no corresponde.
  useEffect(() => {
    setTexto(seleccionado?.texto ?? "");
    setSumilla(seleccionado?.sumilla ?? "");
    setMotivo("");
    setFormError(null);
  }, [seleccionado?.id, seleccionado?.texto, seleccionado?.sumilla]);

  // La lista tiene treinta y tres artículos y scroll propio: si el que vino en
  // la URL es el 28, sin esto se restaura seleccionado pero fuera de pantalla y
  // parece que no pasó nada. `nearest` no hace nada si el ítem ya se ve, así
  // que también sirve al saltar desde los faltantes del articulado completo.
  useEffect(() => {
    botonActivoRef.current?.scrollIntoView({ block: "nearest" });
  }, [seleccionado?.id]);

  const ownsData = dataOwnerId === auth.user?.id;
  const sucio = Boolean(seleccionado)
    && (texto !== (seleccionado?.texto ?? "") || sumilla !== (seleccionado?.sumilla ?? ""));

  // Ahora que la selección vuelve sola, un texto sin guardar sería peor: el
  // artículo reaparece y la redacción no, y desde afuera se lee como que el
  // sistema se comió el trabajo en vez de que nunca se guardó.
  useEffect(() => {
    if (!sucio) return;
    const avisar = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [sucio]);

  const guardar = async () => {
    if (!seleccionado || guardando) return;
    if (motivo.trim().length < MOTIVO_MIN_LENGTH) {
      setFormError(`Contá qué cambiaste y por qué (mínimo ${MOTIVO_MIN_LENGTH} caracteres).`);
      return;
    }
    setGuardando(true);
    setFormError(null);
    try {
      const result = await guardarArticulo({
        articuloId: seleccionado.id,
        texto,
        sumilla: sumilla.trim() || null,
        motivo: motivo.trim(),
      });
      if (!result.ok) {
        setFormError(result.error);
        toast(result.error ?? "No se pudo guardar.", "error");
        return;
      }
      toast("Guardado como versión nueva. El texto anterior queda en el historial.");
      setMotivo("");
      await refresh();
    } finally {
      setGuardando(false);
    }
  };

  const aplicarCambio = async (pendiente: CambioPendiente) => {
    setCambio(null);
    const result = await cambiarEstadoArticulo(
      pendiente.articulo.id,
      pendiente.estado,
      pendiente.fundamento,
    );
    if (!result.ok) {
      toast(result.error ?? "No se pudo cambiar el estado.", "error");
      return;
    }
    toast(`Artículo ${ESTADO_ARTICULO_LABELS[pendiente.estado].toLowerCase()}.`);
    await refresh();
  };

  const exportarObservaciones = async () => {
    if (!proyecto || exportando) return;
    setExportando(true);
    try {
      const resultado = await loadObservacionesDelProyecto(proyecto.id);
      if (!resultado.ok) {
        toast(resultado.error ?? "No se pudieron cargar las observaciones.", "error");
        return;
      }
      const filas = agruparObservaciones(articulos, resultado.data);
      if (filas.length === 0) {
        toast("Todavía no hay observaciones para exportar.", "error");
        return;
      }
      await exportarObservacionesXlsx(filas);
      toast(`Planilla generada con ${filas.length} observaciones.`);
    } catch {
      toast("No se pudo generar la planilla.", "error");
    } finally {
      setExportando(false);
    }
  };

  if (!auth.canRead) return null;

  const aprobados = articulos.filter((articulo) => articulo.estado === "aprobado").length;
  const vigentes = articulos.filter((articulo) => articulo.estado !== "descartado").length;

  return (
    <section id="fabrica" className="section-block !mt-8">
      <button type="button" onClick={onVolver} className="secondary-button compact mb-5">
        Volver al visualizador
      </button>

      <header className="max-w-2xl">
        <span className="micro-label">Redacción normativa</span>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
            Fábrica Normativa
          </h2>
          {/* Distintivo permanente: tiene que verse en cualquier captura que
              salga de una presentación, no ser una nota al pie. */}
          <span className="badge-soft">
            <i style={{ background: "#f59e0b" }}/>
            Proyecto sin sancionar
          </span>
        </div>
        <p className="mt-2 text-tiny leading-5 text-slate-500">
          {proyecto
            ? `${proyecto.titulo}. `
            : ""}
          Cada guardado crea una versión nueva: el texto anterior nunca se pierde. La
          redacción es de la persona; el sistema asiste.
        </p>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="badge-soft">
          <i style={{ background: ESTADO_ARTICULO_COLORS.aprobado }}/>
          {aprobados} de {vigentes} aprobados
        </span>
        <button
          type="button"
          onClick={refresh}
          disabled={loadPhase === "loading"}
          className="secondary-button compact"
        >
          <RefreshCw size={13} className={loadPhase === "loading" ? "animate-spin" : ""}/>
          Actualizar
        </button>
        {proyecto && articulos.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setVerArticulado(true)}
              className="secondary-button compact"
            >
              <FileText size={13}/>
              Ver articulado completo
            </button>
            <button
              type="button"
              onClick={exportarObservaciones}
              disabled={exportando}
              title="Descargar todas las observaciones agrupadas por artículo"
              className="secondary-button compact disabled:opacity-50"
            >
              {exportando ? <Loader2 size={13} className="animate-spin"/> : <Table2 size={13}/>}
              Observaciones en Excel
            </button>
          </>
        )}
      </div>

      {!ownsData || loadPhase === "loading" || loadPhase === "idle" ? (
        <Skeleton/>
      ) : loadPhase === "error" ? (
        <div role="alert" className="mt-5 empty-state border-red-200 bg-red-50">
          <span><AlertTriangle size={22}/></span>
          <h3>No se pudo cargar el articulado</h3>
          <p>
            {loadError} Si las tablas todavía no existen, falta aplicar la migración 21 en
            el SQL Editor.
          </p>
          <button type="button" onClick={refresh} className="secondary-button compact">Reintentar</button>
        </div>
      ) : !proyecto ? (
        <div className="mt-5 empty-state">
          <span><FileText size={22}/></span>
          <h3>Todavía no hay proyecto cargado</h3>
          <p>
            El borrador entra por script, no desde acá. Con las migraciones 20 y 21
            aplicadas, corré <span className="font-mono">npm run ingest:docs</span> y el
            articulado queda sembrado.
          </p>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          {/* Lista */}
          <div className="max-h-[32rem] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2">
            <ul className="grid gap-1">
              {articulos.map((articulo) => {
                const activo = articulo.id === seleccionId;
                return (
                  <li key={articulo.id}>
                    <button
                      type="button"
                      ref={activo ? botonActivoRef : undefined}
                      onClick={() => seleccionar(articulo.id)}
                      aria-current={activo ? "true" : undefined}
                      className={`w-full rounded-xl px-2.5 py-2 text-left transition duration-fast ${
                        activo ? "bg-municipal-50" : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <b className={`text-tiny ${activo ? "text-municipal-700" : "text-ink"}`}>
                          Artículo {articulo.numero ?? articulo.orden}
                        </b>
                        <span className="badge-soft shrink-0">
                          <i style={{ background: ESTADO_ARTICULO_COLORS[articulo.estado] }}/>
                          {ESTADO_ARTICULO_LABELS[articulo.estado]}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-micro text-slate-500">
                        {articulo.sumilla || articulo.texto.slice(0, 60)}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Editor */}
          {!seleccionado ? (
            <div className="empty-state">
              <span><FileText size={22}/></span>
              <h3>Elegí un artículo</h3>
              <p>La lista trae los {articulos.length} artículos del borrador recibido.</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <span className="micro-label">
                    Artículo {seleccionado.numero ?? seleccionado.orden} ·{" "}
                    {ORIGEN_ARTICULO_LABELS[seleccionado.origen]}
                  </span>
                  <h3 className="mt-0.5 font-display text-base font-extrabold text-ink">
                    {seleccionado.sumilla || "Sin sumilla"}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setHistorialDe(seleccionado)}
                  className="secondary-button compact"
                >
                  <History size={13}/>
                  Historial
                </button>
              </div>

              <label className="mt-3 block">
                <span className="micro-label">Sumilla</span>
                <input
                  value={sumilla}
                  onChange={(event) => setSumilla(event.target.value)}
                  disabled={!puedeEscribir}
                  maxLength={200}
                  className="mt-1 min-h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-tiny text-slate-700 outline-none focus:border-municipal-500 disabled:bg-slate-50"
                />
              </label>

              <label className="mt-3 block">
                <span className="micro-label">Texto del artículo</span>
                <textarea
                  value={texto}
                  onChange={(event) => setTexto(event.target.value)}
                  disabled={!puedeEscribir}
                  rows={12}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-tiny leading-5 text-slate-700 outline-none focus:border-municipal-500 disabled:bg-slate-50"
                />
              </label>

              {puedeEscribir && (
                <>
                  <label className="mt-3 block">
                    <span className="micro-label">Motivo del cambio (obligatorio)</span>
                    <textarea
                      value={motivo}
                      onChange={(event) => setMotivo(event.target.value)}
                      rows={2}
                      maxLength={500}
                      placeholder={`Qué cambiaste y por qué (mínimo ${MOTIVO_MIN_LENGTH} caracteres)`}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-tiny text-slate-700 outline-none focus:border-municipal-500"
                    />
                  </label>

                  {formError && (
                    <p role="alert" className="mt-2 text-micro font-semibold text-red-700">{formError}</p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={guardar}
                      disabled={guardando || !sucio}
                      title={sucio ? "Guardar como versión nueva" : "No hay cambios que guardar"}
                      className="primary-button compact disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {guardando ? <Loader2 size={13} className="animate-spin"/> : <Save size={13}/>}
                      Guardar versión
                    </button>

                    {SIGUIENTES[seleccionado.estado].map((estado) => (
                      <button
                        key={estado}
                        type="button"
                        onClick={() => setCambio({ articulo: seleccionado, estado, fundamento: motivo.trim() })}
                        disabled={motivo.trim().length < MOTIVO_MIN_LENGTH}
                        title={
                          motivo.trim().length < MOTIVO_MIN_LENGTH
                            ? "Escribí primero el fundamento en el campo de motivo."
                            : `Pasar a ${ESTADO_ARTICULO_LABELS[estado]}`
                        }
                        className="secondary-button compact disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {ESTADO_ARTICULO_LABELS[estado]}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {!puedeEscribir && (
                <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-micro leading-4 text-slate-500">
                  Tu rol puede leer el articulado y dejar observaciones, pero no editarlo.
                </p>
              )}

              <PanelDiagnostico
                articulo={seleccionado}
                carteles={carteles}
                onVerEnMapa={onVerEnMapa}
              />

              <ObservacionesArticulo articulo={seleccionado}/>
            </div>
          )}
        </div>
      )}

      {cambio && (
        <ConfirmDialog
          title={`Pasar el artículo a ${ESTADO_ARTICULO_LABELS[cambio.estado]}`}
          description={`Artículo ${cambio.articulo.numero ?? cambio.articulo.orden}. El cambio queda asentado con este fundamento:`}
          quote={cambio.fundamento}
          tone={cambio.estado === "descartado" ? "discard" : cambio.estado === "aprobado" ? "approve" : "reject"}
          confirmLabel={ESTADO_ARTICULO_LABELS[cambio.estado]}
          onConfirm={() => void aplicarCambio(cambio)}
          onCancel={() => setCambio(null)}
        />
      )}

      {historialDe && (
        <HistorialArticulo articulo={historialDe} onClose={() => setHistorialDe(null)}/>
      )}

      {verArticulado && proyecto && (
        <ArticuladoCompleto
          proyecto={proyecto}
          articulos={articulos}
          onClose={() => setVerArticulado(false)}
          onIrAlArticulo={seleccionar}
        />
      )}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]" aria-label="Cargando articulado">
      <div className="skeleton h-80 rounded-2xl"/>
      <div className="skeleton h-80 rounded-2xl"/>
    </div>
  );
}
