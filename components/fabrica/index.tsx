"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, FileText, History, Loader2, PenLine, RefreshCw, RotateCcw, Save, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  ORIGEN_ARTICULO_LABELS,
  cambiarEstadoArticulo,
  guardarArticulo,
  loadArticulos,
  loadProyectoActivo,
  type ArticuloNorma,
  type ProyectoNorma,
} from "@/lib/fabrica-repository";
import { toast } from "../toaster";
import { ArticuladoCompleto } from "./articulado-completo";
import { HistorialArticulo } from "./historial-articulo";
import { LienzoArticulo } from "./lienzo-articulo";
import { RevisorProyecto } from "./revisor-proyecto";
import { Simulador } from "./simulador";

type LoadPhase = "idle" | "loading" | "ready" | "error";

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
export default function Fabrica({ onVolver }: { onVolver: () => void }) {
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
  const [formError, setFormError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [historialDe, setHistorialDe] = useState<ArticuloNorma | null>(null);
  const [verArticulado, setVerArticulado] = useState(false);
  const [lienzoAbierto, setLienzoAbierto] = useState(false);
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

  // Abrir un artículo carga su texto vigente en el editor.
  useEffect(() => {
    setTexto(seleccionado?.texto ?? "");
    setSumilla(seleccionado?.sumilla ?? "");
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
    setGuardando(true);
    setFormError(null);
    try {
      // Sin motivo: guardar es guardar. La versión se registra igual, con
      // fecha y autor, así que el texto anterior no se pierde.
      const result = await guardarArticulo({
        articuloId: seleccionado.id,
        texto,
        sumilla: sumilla.trim() || null,
        motivo: "",
      });
      if (!result.ok) {
        setFormError(result.error);
        toast(result.error ?? "No se pudo guardar.", "error");
        return;
      }
      toast("Guardado.");
      await refresh();
    } finally {
      setGuardando(false);
    }
  };

  /**
   * Quitar un artículo del documento, y volver a meterlo.
   *
   * Es lo único que queda del viejo juego de estados: `descartado` significa
   * "no va en el documento" y nada más. No se borra, así que volver atrás es
   * un clic y el texto sigue en el historial.
   */
  const alternarInclusion = async (articulo: ArticuloNorma) => {
    const quitar = articulo.estado !== "descartado";
    const result = await cambiarEstadoArticulo(
      articulo.id,
      quitar ? "descartado" : "propuesto",
      "",
    );
    if (!result.ok) {
      toast(result.error ?? "No se pudo cambiar el artículo.", "error");
      return;
    }
    toast(quitar ? "Quitado del documento. Podés volver a incluirlo." : "Vuelve al documento.");
    await refresh();
  };

  if (!auth.canRead) return null;

  const incluidos = articulos.filter((articulo) => articulo.estado !== "descartado").length;

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
          {proyecto ? `${proyecto.titulo}. ` : ""}
          {incluidos} artículo{incluidos === 1 ? "" : "s"} en el documento. Cada guardado
          deja el texto anterior en el historial.
        </p>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {proyecto && puedeEscribir && (
          <button
            type="button"
            onClick={() => setLienzoAbierto(true)}
            title="Escribir un artículo nuevo partiendo de una idea en lenguaje llano"
            className="primary-button compact"
          >
            <PenLine size={13}/>
            Artículo nuevo
          </button>
        )}
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
          <button
            type="button"
            onClick={() => setVerArticulado(true)}
            className="secondary-button compact"
          >
            <FileText size={13}/>
            Ver y exportar el documento
          </button>
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
                        {articulo.estado === "descartado" && (
                          <span className="badge-soft shrink-0">
                            <i style={{ background: "#94a3b8" }}/>
                            Fuera
                          </span>
                        )}
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
                  {formError && (
                    <p role="alert" className="mt-2 text-micro font-semibold text-red-700">{formError}</p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={guardar}
                      disabled={guardando || !sucio}
                      title={sucio ? "Guardar" : "No hay cambios que guardar"}
                      className="primary-button compact disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {guardando ? <Loader2 size={13} className="animate-spin"/> : <Save size={13}/>}
                      Guardar
                    </button>

                    <button
                      type="button"
                      onClick={() => void alternarInclusion(seleccionado)}
                      title={
                        seleccionado.estado === "descartado"
                          ? "Volver a incluirlo en el documento"
                          : "Sacarlo del documento. No se borra: podés volver a incluirlo."
                      }
                      className="secondary-button compact"
                    >
                      {seleccionado.estado === "descartado"
                        ? <><RotateCcw size={13}/>Volver a incluir</>
                        : <><Trash2 size={13}/>Quitar del documento</>}
                    </button>
                  </div>
                </>
              )}

              {!puedeEscribir && (
                <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-micro leading-4 text-slate-500">
                  Tu rol puede leer el articulado, pero no editarlo.
                </p>
              )}

              {/* Revisa el texto del editor, no el guardado: sirve mientras se
                  escribe, que es cuando conviene enterarse. */}
              <RevisorProyecto articulo={seleccionado} texto={texto}/>
            </div>
          )}
        </div>
      )}

      {/* Fuera del editor: calibrar los números es del documento entero, no de
          un artículo. Adentro pedía los mismos tres parámetros en los treinta y
          tres, incluido el que define el objeto de la ordenanza. */}
      {proyecto && loadPhase === "ready" && <Simulador/>}

      {historialDe && (
        <HistorialArticulo articulo={historialDe} onClose={() => setHistorialDe(null)}/>
      )}

      {lienzoAbierto && proyecto && (
        <LienzoArticulo
          proyectoId={proyecto.id}
          onClose={() => setLienzoAbierto(false)}
          onCreado={(articuloId) => {
            // Se abre el artículo recién creado: quedarse en la lista después
            // de escribirlo obligaría a buscarlo entre treinta y cuatro.
            if (articuloId) seleccionar(articuloId);
            void refresh();
          }}
        />
      )}

      {verArticulado && proyecto && (
        <ArticuladoCompleto
          proyecto={proyecto}
          articulos={articulos}
          onClose={() => setVerArticulado(false)}
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
