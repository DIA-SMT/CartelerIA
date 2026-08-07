"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, BarChart3, Gauge, Lock, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  PROCEDENCIA_LABELS,
  loadIndicadores,
  loadZonasDisponibles,
  type Indicador,
  type IndicadoresGestion as IndicadoresGestionData,
  type ZonaDisponible,
} from "@/lib/indicadores-repository";

type LoadPhase = "idle" | "loading" | "ready" | "error";

/** Ventanas ofrecidas. `null` = sin límite inferior (todo el registro). */
const VENTANAS: { clave: string; label: string; dias: number | null }[] = [
  { clave: "90", label: "90 días", dias: 90 },
  { clave: "365", label: "12 meses", dias: 365 },
  { clave: "todo", label: "Todo", dias: null },
];

function desdeVentana(dias: number | null): string | null {
  if (dias === null) return "2000-01-01";
  const desde = new Date();
  desde.setDate(desde.getDate() - dias);
  return desde.toISOString().slice(0, 10);
}

function formatValor(indicador: Indicador): string {
  if (!indicador.suficiente || indicador.valor === null) return "Sin datos";
  if (indicador.unidad === "porcentaje") return `${indicador.valor}%`;
  if (indicador.unidad === "dias") {
    const dias = Math.round(indicador.valor);
    return `${dias} ${dias === 1 ? "día" : "días"}`;
  }
  return String(indicador.valor);
}

/**
 * Indicadores de gestión del roadmap, calculados en PostgreSQL.
 *
 * Dos reglas mandan sobre la estética: un indicador sin datos suficientes se
 * muestra como tal y nunca como cero (un 0% de regularización dice algo muy
 * distinto de "todavía nadie recibió observaciones"), y cada número declara de
 * dónde sale, para que nadie lo cite como dato oficial si no lo es.
 */
export function IndicadoresGestion() {
  const auth = useAuth();
  const canRead = auth.canRead;

  const [data, setData] = useState<IndicadoresGestionData | null>(null);
  const [zonas, setZonas] = useState<ZonaDisponible[]>([]);
  const [ventana, setVentana] = useState("365");
  const [zona, setZona] = useState<string>("");
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataOwnerId, setDataOwnerId] = useState<string | null>(null);
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    if (!canRead) {
      setData(null);
      setZonas([]);
      setLoadError(null);
      setLoadPhase("idle");
      setDataOwnerId(null);
      return;
    }
    setData(null);
    setDataOwnerId(null);
    setLoadPhase("loading");
    setLoadError(null);
    const dias = VENTANAS.find((item) => item.clave === ventana)?.dias ?? 365;
    const [indicadores, zonasResult] = await Promise.all([
      loadIndicadores({ desde: desdeVentana(dias), zona: zona || null }),
      loadZonasDisponibles(),
    ]);
    if (sequence !== refreshSequence.current) return;
    setDataOwnerId(auth.user?.id ?? null);
    setZonas(zonasResult.data);
    if (!indicadores.ok || !indicadores.data) {
      setLoadError(indicadores.error);
      setLoadPhase("error");
      return;
    }
    setData(indicadores.data);
    setLoadError(null);
    setLoadPhase("ready");
  }, [canRead, auth.user?.id, ventana, zona]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshSequence.current += 1;
    };
  }, [refresh]);

  // Sin sesión la sección no aparece: la nav tampoco la ofrece.
  if (!auth.user) return null;
  const ownsData = dataOwnerId === auth.user.id;

  return (
    <section id="indicadores" className="section-block">
      <div className="section-heading">
        <div>
          <span className="section-kicker">Gestión</span>
          <h2>Indicadores de gestión</h2>
          <p>Calculados sobre el registro real. Cada indicador declara su procedencia.</p>
        </div>
        {canRead && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="indicadores-zona">Zona</label>
            <select
              id="indicadores-zona"
              value={zona}
              onChange={(event) => setZona(event.target.value)}
              className="min-h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-tiny font-semibold text-slate-700 outline-none focus:border-municipal-500"
            >
              <option value="">Todas las zonas</option>
              {zonas.map((item) => (
                <option key={item.zona} value={item.zona}>{item.zona} ({item.cantidad})</option>
              ))}
            </select>
            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
              {VENTANAS.map((item) => (
                <button
                  key={item.clave}
                  type="button"
                  onClick={() => setVentana(item.clave)}
                  aria-pressed={ventana === item.clave}
                  className={`min-h-8 rounded-md px-2.5 text-micro font-extrabold transition duration-fast ${
                    ventana === item.clave
                      ? "bg-municipal-600 text-white"
                      : "text-slate-500 hover:text-municipal-700"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={refresh}
              disabled={loadPhase === "loading"}
              className="secondary-button compact"
              aria-label="Actualizar indicadores"
            >
              <RefreshCw size={13} className={loadPhase === "loading" ? "animate-spin" : ""}/>
            </button>
          </div>
        )}
      </div>

      {!canRead ? (
        auth.roleError ? (
          <div className="empty-state border-red-200 bg-red-50">
            <span><Lock size={22}/></span>
            <h3>Permisos no verificados</h3>
            <p>{auth.roleError}</p>
            <button type="button" onClick={() => void auth.retryRole()} className="secondary-button compact">Reintentar permisos</button>
          </div>
        ) : (
          <CardsSkeleton/>
        )
      ) : !ownsData || loadPhase === "idle" || loadPhase === "loading" ? (
        <CardsSkeleton/>
      ) : loadPhase === "error" || !data ? (
        <div role="alert" className="empty-state border-red-200 bg-red-50">
          <span><AlertTriangle size={22}/></span>
          <h3>No se pudieron calcular los indicadores</h3>
          <p>{loadError} Reintentá o revisá tu sesión.</p>
          <button type="button" onClick={refresh} className="secondary-button compact">Reintentar</button>
        </div>
      ) : (
        <>
          <p className="mb-3 text-tiny text-slate-500">
            Período {new Date(`${data.periodo.desde}T00:00:00`).toLocaleDateString("es-AR")} –{" "}
            {new Date(`${data.periodo.hasta}T00:00:00`).toLocaleDateString("es-AR")}
            {data.periodo.zona ? ` · ${data.periodo.zona}` : " · todas las zonas"}
            {" · "}fecha de alta del registro administrativo.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.indicadores.map((indicador) => (
              <IndicadorCard key={indicador.clave} indicador={indicador}/>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function IndicadorCard({ indicador }: { indicador: Indicador }) {
  const insuficiente = !indicador.suficiente;
  // `scale-in` anima solo transform y opacity; `prefers-reduced-motion` la
  // neutraliza globalmente desde globals.css.
  return (
    <article className="animate-scale-in rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-municipal-50 text-municipal-700">
          {indicador.unidad === "rangos" ? <BarChart3 size={17}/> : <Gauge size={17}/>}
        </span>
        <span className="badge-soft">
          <i style={{ background: insuficiente ? "#94a3b8" : "#0166FF" }}/>
          {PROCEDENCIA_LABELS[indicador.procedencia]}
        </span>
      </div>

      <strong
        className={`mt-3 block font-display text-2xl font-extrabold tracking-tight ${
          insuficiente ? "text-slate-400" : "text-ink"
        }`}
      >
        {formatValor(indicador)}
      </strong>
      <span className="text-xs font-semibold text-slate-500">{indicador.etiqueta}</span>

      {indicador.suficiente
        && indicador.denominador !== null
        && indicador.numerador !== null
        && indicador.unidad === "porcentaje" && (
        <p className="mt-1 text-micro font-semibold text-slate-400">
          {indicador.numerador} de {indicador.denominador}
        </p>
      )}

      {indicador.rangos.length > 0 && (
        <ul className="mt-2.5 space-y-1">
          {indicador.rangos.map((rango) => (
            <li key={rango.clave} className="flex items-center justify-between gap-2 text-tiny">
              <span className="text-slate-500">{rango.etiqueta}</span>
              <b className="text-slate-700">{rango.cantidad}</b>
            </li>
          ))}
        </ul>
      )}

      <p className={`mt-2.5 text-micro leading-4 ${insuficiente ? "text-amber-700" : "text-slate-400"}`}>
        {indicador.detalle}
      </p>
    </article>
  );
}

function CardsSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Cargando indicadores">
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <div key={index} className="skeleton h-40 rounded-2xl"/>
      ))}
    </div>
  );
}
