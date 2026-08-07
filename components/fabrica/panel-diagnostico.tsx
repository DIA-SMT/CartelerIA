"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, Loader2, MapPin, Play, Wand2 } from "lucide-react";
import type { AnalyzedCartel } from "@/data/territorial";
import { useAuth } from "@/hooks/use-auth";
import {
  confirmarParametro,
  loadParametros,
  type ArticuloNorma,
  type ParametroGuardado,
} from "@/lib/fabrica-repository";
import { proponerCitaParaValor } from "@/lib/norma-citas";
import {
  PARAMETRO_LABELS,
  ParametroSinConfirmarError,
  simularArticulo,
  type ClaveParametro,
  type ResumenSimulacion,
} from "@/lib/norma-simulador";
import { toast } from "../toaster";

/** Parámetros numéricos y su unidad. Las zonas se cargan aparte. */
const NUMERICOS: { clave: ClaveParametro; unidad: string; ayuda: string }[] = [
  { clave: "superficie_maxima_m2", unidad: "m²", ayuda: "El máximo es… metros cuadrados" },
  { clave: "distancia_minima_corredor_m", unidad: "m", ayuda: "Se exige una distancia mínima de… al corredor" },
  { clave: "distancia_minima_lugar_permitido_m", unidad: "m", ayuda: "Se exige una distancia mínima de… al lugar permitido" },
];

/**
 * Qué pasaría con los carteles relevados si este artículo rigiera.
 *
 * El motor es determinístico y no llama a ningún modelo: un cartel sin el dato
 * no cumple ni incumple, falta información. Es lo que hace que el número que se
 * muestre se pueda defender en una reunión.
 *
 * Cada parámetro se confirma con la oración del artículo que lo fija. La cita
 * se propone sola a partir del número, así que confirmar es un clic; PostgreSQL
 * la vuelve a validar textual, que es lo que evita que un número salga de la
 * nada.
 */
export function PanelDiagnostico({
  articulo,
  carteles,
  onVerEnMapa,
}: {
  articulo: ArticuloNorma;
  carteles: AnalyzedCartel[];
  onVerEnMapa: (ids: string[]) => void;
}) {
  const auth = useAuth();
  const puedeConfirmar = auth.canInspect;

  const [parametros, setParametros] = useState<ParametroGuardado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [simulacion, setSimulacion] = useState<ResumenSimulacion | null>(null);
  const [errorSimulacion, setErrorSimulacion] = useState<string | null>(null);
  const secuencia = useRef(0);

  const refresh = useCallback(async () => {
    const actual = ++secuencia.current;
    setCargando(true);
    const resultado = await loadParametros(articulo.id);
    if (actual !== secuencia.current) return;
    setParametros(resultado.data);
    setError(resultado.ok ? null : resultado.error);
    setCargando(false);
  }, [articulo.id]);

  useEffect(() => {
    void refresh();
    setSimulacion(null);
    setErrorSimulacion(null);
    return () => { secuencia.current += 1; };
  }, [refresh]);

  const correrSimulacion = () => {
    setErrorSimulacion(null);
    try {
      const { resumen } = simularArticulo(
        carteles,
        parametros.map((parametro) => ({
          clave: parametro.clave,
          valor: parametro.valor,
          unidad: parametro.unidad,
          cita: parametro.cita,
          confirmado: parametro.confirmadoEn !== null,
        })),
      );
      setSimulacion(resumen);
    } catch (fallo) {
      // Un parámetro sin confirmar no se ignora: la simulación falla y se dice
      // por qué. Un número calculado sobre supuestos no sirve para decidir.
      setSimulacion(null);
      setErrorSimulacion(
        fallo instanceof ParametroSinConfirmarError
          ? fallo.message
          : "No se pudo correr la simulación.",
      );
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
      <span className="micro-label">Impacto sobre los carteles relevados</span>
      <p className="mt-1 text-micro leading-4 text-slate-500">
        Un parámetro es una regla que se pueda escribir en una oración: “el máximo es…”,
        “se exige…”. Cargá el número y la cita se busca sola en el artículo.
      </p>

      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-micro font-semibold text-red-800">{error}</p>
      )}

      {cargando ? (
        <div className="mt-3 space-y-2">
          <div className="skeleton h-12 rounded-xl"/>
          <div className="skeleton h-12 rounded-xl"/>
        </div>
      ) : (
        <div className="mt-3 grid gap-2">
          {NUMERICOS.map((definicion) => (
            <FilaParametro
              key={definicion.clave}
              definicion={definicion}
              articulo={articulo}
              guardado={parametros.find((parametro) => parametro.clave === definicion.clave) ?? null}
              puedeConfirmar={puedeConfirmar}
              onGuardado={refresh}
            />
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={correrSimulacion}
          disabled={parametros.length === 0 || carteles.length === 0}
          title={parametros.length === 0 ? "Cargá al menos un parámetro." : "Correr la simulación"}
          className="primary-button compact disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play size={13}/>
          Simular sobre {carteles.length} carteles
        </button>
        {simulacion && simulacion.idsNoCumple.length > 0 && (
          <button
            type="button"
            onClick={() => onVerEnMapa(simulacion.idsNoCumple)}
            className="secondary-button compact"
          >
            <MapPin size={13}/>
            Ver en el mapa los {simulacion.idsNoCumple.length} que no cumplen
          </button>
        )}
      </div>

      {errorSimulacion && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-micro font-semibold leading-4 text-amber-800">
          <AlertTriangle size={12} className="mt-0.5 shrink-0"/>
          {errorSimulacion}
        </p>
      )}

      {simulacion && (
        <div className="mt-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <Tarjeta label="Cumplen" valor={simulacion.cumple} color="#16a34a" icono={<CheckCircle2 size={14}/>}/>
            <Tarjeta label="No cumplen" valor={simulacion.noCumple} color="#dc2626" icono={<AlertTriangle size={14}/>}/>
            <Tarjeta label="No evaluables" valor={simulacion.noEvaluable} color="#64748b" icono={<HelpCircle size={14}/>}/>
          </div>

          {simulacion.faltantes.length > 0 && (
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-micro leading-4 text-slate-500">
              Quedaron sin evaluar por falta de dato:{" "}
              {simulacion.faltantes.map((f) => `${f.cantidad} sin ${f.campo}`).join(", ")}. Un
              cartel sin el dato no cumple ni incumple: falta información.
            </p>
          )}

          {simulacion.porZona.length > 0 && (
            <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[420px] text-left text-tiny">
                <thead className="bg-slate-50">
                  <tr className="micro-label">
                    <th className="px-3 py-2">Zona</th>
                    <th className="px-3 py-2 text-center">Cumple</th>
                    <th className="px-3 py-2 text-center">No cumple</th>
                    <th className="px-3 py-2 text-center">No evaluable</th>
                  </tr>
                </thead>
                <tbody>
                  {simulacion.porZona.map((fila) => (
                    <tr key={fila.zona} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-600">{fila.zona.replace(/_/g, " ")}</td>
                      <td className="px-3 py-2 text-center text-slate-600">{fila.cumple}</td>
                      <td className="px-3 py-2 text-center font-bold text-red-700">{fila.noCumple}</td>
                      <td className="px-3 py-2 text-center text-slate-400">{fila.noEvaluable}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-2 text-micro leading-4 text-slate-400">
            La simulación es un insumo para decidir. No determina que un cartel esté en
            infracción bajo el texto en construcción.
          </p>
        </div>
      )}
    </div>
  );
}

function Tarjeta({ label, valor, color, icono }: { label: string; valor: number; color: string; icono: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <span className="flex items-center gap-1.5 text-micro font-extrabold uppercase tracking-wider" style={{ color }}>
        {icono}
        {label}
      </span>
      <b className="mt-1 block font-display text-2xl font-extrabold tracking-tight text-ink">{valor}</b>
    </div>
  );
}

function FilaParametro({
  definicion,
  articulo,
  guardado,
  puedeConfirmar,
  onGuardado,
}: {
  definicion: { clave: ClaveParametro; unidad: string; ayuda: string };
  articulo: ArticuloNorma;
  guardado: ParametroGuardado | null;
  puedeConfirmar: boolean;
  onGuardado: () => Promise<void>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState(guardado ? String(guardado.valor) : "");
  const [cita, setCita] = useState(guardado?.cita ?? "");
  const [citaAutomatica, setCitaAutomatica] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  /**
   * Busca sola la oración del artículo donde aparece el número.
   *
   * Solo pisa la cita si la había puesto ella misma: lo que escribió una
   * persona no se toca. Si no encuentra nada, no inventa — deja el campo para
   * que se pegue a mano.
   */
  const alCambiarValor = (nuevo: string) => {
    setValor(nuevo);
    setError(null);
    const numero = Number(nuevo);
    if (!Number.isFinite(numero) || nuevo.trim() === "") return;
    if (cita.trim() !== "" && !citaAutomatica) return;
    const propuesta = proponerCitaParaValor(articulo.texto, numero);
    setCita(propuesta ?? "");
    setCitaAutomatica(propuesta !== null);
  };

  const confirmar = async () => {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) {
      setError("El valor tiene que ser un número.");
      return;
    }
    // Se valida acá lo mismo que valida PostgreSQL, para que el error se vea
    // antes de enviar y no como un rechazo de la base.
    if (!articulo.texto.includes(cita.trim()) || cita.trim().length < 25) {
      setError("La cita tiene que estar copiada textualmente del artículo (mínimo 25 caracteres).");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const resultado = await confirmarParametro({
        articuloId: articulo.id,
        clave: definicion.clave,
        valor: numero,
        unidad: definicion.unidad,
        cita: cita.trim(),
        fundamento: `Confirmado desde el artículo ${articulo.numero ?? articulo.orden}`,
      });
      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }
      toast(`${PARAMETRO_LABELS[definicion.clave]} cargada.`);
      setAbierto(false);
      await onGuardado();
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-tiny font-bold text-slate-700">{PARAMETRO_LABELS[definicion.clave]}</span>
        {guardado ? (
          <span className="badge-soft">
            <i style={{ background: "#16a34a" }}/>
            {String(guardado.valor)} {guardado.unidad ?? ""}
          </span>
        ) : (
          <span className="text-micro text-slate-400">sin cargar</span>
        )}
        {puedeConfirmar && (
          <button
            type="button"
            onClick={() => setAbierto((valor) => !valor)}
            className="secondary-button compact"
          >
            {guardado ? "Corregir" : "Cargar"}
          </button>
        )}
      </div>

      {abierto && puedeConfirmar && (
        <div className="mt-2 grid gap-2">
          <label className="block">
            <span className="micro-label">Valor ({definicion.unidad}) · {definicion.ayuda}</span>
            <input
              value={valor}
              onChange={(event) => alCambiarValor(event.target.value)}
              inputMode="decimal"
              className="mt-1 min-h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-tiny outline-none focus:border-municipal-500"
            />
          </label>
          <label className="block">
            <span className="micro-label">
              Dónde lo dice el artículo
              {citaAutomatica && (
                <span className="badge-soft ml-1.5">
                  <i style={{ background: "#0891b2" }}/>
                  <Wand2 size={9} className="mr-0.5"/>
                  encontrada sola
                </span>
              )}
            </span>
            <textarea
              value={cita}
              onChange={(event) => { setCita(event.target.value); setCitaAutomatica(false); }}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-tiny outline-none focus:border-municipal-500"
              placeholder="Se busca sola al escribir el valor. Si no aparece, pegá la parte del artículo que lo fija."
            />
          </label>
          {error && <p role="alert" className="text-micro font-semibold text-red-700">{error}</p>}
          <button
            type="button"
            onClick={confirmar}
            disabled={guardando}
            className="primary-button compact justify-center disabled:opacity-50"
          >
            {guardando ? <Loader2 size={13} className="animate-spin"/> : null}
            Guardar parámetro
          </button>
        </div>
      )}
    </div>
  );
}
