"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import type { CartelRecord } from "@/data/carteles";
import { useAuth } from "@/hooks/use-auth";
import { loadCarteles } from "@/lib/cartel-repository";
import {
  distribucionSuperficie,
  simularSuperficieMaxima,
  type ResumenSimulacion,
} from "@/lib/norma-simulador";

type LoadPhase = "idle" | "loading" | "ready" | "error";

/** Valores para tantear rápido, incluido el que hoy fija el articulado. */
const ATAJOS = [6, 20, 40, 60];

/**
 * Qué pasaría con los carteles relevados si la ordenanza fijara tal máximo.
 *
 * Es una calculadora, no un formulario: se mueve el número y el resultado se
 * recalcula. No guarda nada, no pide citas y no confirma. Lo que se decide con
 * esto se escribe en el artículo, que es donde tiene que estar.
 *
 * Vive fuera del editor a propósito. Antes era un panel dentro de cada
 * artículo, pidiendo los mismos tres parámetros en los treinta y tres —incluido
 * el que define el objeto de la ordenanza, donde no hay ninguna medida que
 * cargar—. Calibrar los números es una actividad del documento entero.
 *
 * Lee el registro administrativo directo y no el mapa: por el mapa solo pasan
 * los carteles con vínculo territorial aprobado, y hoy hay uno.
 */
export function Simulador() {
  const auth = useAuth();
  const [carteles, setCarteles] = useState<CartelRecord[]>([]);
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("idle");
  const [maximo, setMaximo] = useState("40");
  const [dataOwnerId, setDataOwnerId] = useState<string | null>(null);
  const secuencia = useRef(0);

  const refresh = useCallback(async () => {
    const actual = ++secuencia.current;
    setLoadPhase("loading");
    const resultado = await loadCarteles(auth.role);
    if (actual !== secuencia.current) return;
    setDataOwnerId(auth.user?.id ?? null);
    setCarteles(resultado.data);
    setLoadPhase(resultado.source === "unavailable" ? "error" : "ready");
  }, [auth.role, auth.user?.id]);

  useEffect(() => {
    void refresh();
    return () => { secuencia.current += 1; };
  }, [refresh]);

  const ownsData = dataOwnerId === auth.user?.id;
  const valor = Number(maximo);
  const valido = Number.isFinite(valor) && valor > 0;
  const resumen: ResumenSimulacion | null = valido && carteles.length > 0
    ? simularSuperficieMaxima(carteles, valor)
    : null;
  const distribucion = carteles.length > 0 ? distribucionSuperficie(carteles) : null;

  return (
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="micro-label">Qué pasaría con los carteles relevados</span>
          <p className="mt-0.5 max-w-xl text-micro leading-4 text-slate-500">
            Poné el máximo que estás pensando y mirá a cuántos carteles alcanzaría. No se
            guarda nada: lo que decidas se escribe en el artículo.
          </p>
        </div>
      </div>

      {!ownsData || loadPhase === "loading" || loadPhase === "idle" ? (
        <div className="mt-3 space-y-2" aria-label="Cargando el registro">
          <div className="skeleton h-16 rounded-xl"/>
          <div className="skeleton h-24 rounded-xl"/>
        </div>
      ) : loadPhase === "error" || carteles.length === 0 ? (
        <p role="alert" className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-micro leading-4 text-amber-800">
          No se pudo leer el registro de carteles. Sin él no hay contra qué simular.
        </p>
      ) : (
        <>
          {distribucion && (
            <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-micro leading-4 text-slate-600">
              Hoy, de los {carteles.length} carteles relevados: el más chico tiene{" "}
              <b>{distribucion.minimo} m²</b>, la mitad está por debajo de{" "}
              <b>{distribucion.mediana} m²</b> y el más grande llega a{" "}
              <b>{distribucion.maximo} m²</b>. El grueso cae entre {distribucion.p25} y{" "}
              {distribucion.p75}.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="micro-label">Superficie máxima por cara (m²)</span>
              <input
                value={maximo}
                onChange={(event) => setMaximo(event.target.value)}
                inputMode="decimal"
                className="mt-1 min-h-9 w-32 rounded-lg border border-slate-200 bg-white px-2.5 font-display text-base font-extrabold text-ink outline-none focus:border-municipal-500"
              />
            </label>
            <div className="flex flex-wrap items-center gap-1 pb-0.5">
              {ATAJOS.map((atajo) => (
                <button
                  key={atajo}
                  type="button"
                  onClick={() => setMaximo(String(atajo))}
                  aria-pressed={maximo === String(atajo)}
                  className={`min-h-8 rounded-lg px-2.5 text-micro font-bold transition duration-fast ${
                    maximo === String(atajo)
                      ? "bg-municipal-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {atajo} m²
                </button>
              ))}
            </div>
          </div>

          {!valido ? (
            <p className="mt-3 text-micro font-semibold text-red-700">Poné un número mayor que cero.</p>
          ) : resumen && (
            <>
              <div className="mt-3 rounded-2xl border border-slate-200 p-4">
                <p className="font-display text-2xl font-extrabold tracking-tight text-ink">
                  <span className={resumen.superan > 0 ? "text-red-700" : "text-green-700"}>
                    {resumen.superan}
                  </span>{" "}
                  de {resumen.conDato} carteles quedarían fuera de norma
                </p>
                <p className="mt-1 text-tiny text-slate-500">
                  Es el {resumen.porcentaje}% de los que tienen la superficie cargada.
                  {resumen.sinDato > 0 && (
                    <> Otros {resumen.sinDato} no se pueden evaluar porque les falta el dato:
                    no cumplen ni incumplen.</>
                  )}
                </p>
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <Corte titulo="Por zona" filas={resumen.porZona}/>
                <Corte titulo="Por tipo de cartel" filas={resumen.porTipo}/>
              </div>
            </>
          )}

          {/* Lo que todavía no se puede, dicho con su motivo: omitirlo se leería
              como olvido, y saber qué falta para destrabarlo es la mitad del
              trabajo. */}
          <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-slate-50 px-3 py-2 text-micro leading-4 text-slate-500">
            <Lock size={12} className="mt-0.5 shrink-0"/>
            <span>
              Las reglas de <b>distancia</b> —a un corredor, a una escuela— todavía no se
              pueden simular: salen de la geometría del mapa y necesitan que cada cartel
              esté vinculado a su punto. Hoy hay 1 vínculo aprobado de {carteles.length}.
              Se destraba ratificándolos desde la bandeja de aprobaciones.
            </span>
          </p>
        </>
      )}
    </section>
  );
}

function Corte({ titulo, filas }: { titulo: string; filas: { etiqueta: string; total: number; superan: number; sinDato: number }[] }) {
  if (filas.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-left text-tiny">
        <thead className="bg-slate-50">
          <tr className="micro-label">
            <th className="px-3 py-2">{titulo}</th>
            <th className="px-3 py-2 text-center">Fuera</th>
            <th className="px-3 py-2 text-center">Total</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => (
            <tr key={fila.etiqueta} className="border-t border-slate-100">
              <td className="px-3 py-2 text-slate-600">{fila.etiqueta}</td>
              <td className={`px-3 py-2 text-center font-bold ${fila.superan > 0 ? "text-red-700" : "text-slate-400"}`}>
                {fila.superan}
              </td>
              <td className="px-3 py-2 text-center text-slate-500">
                {fila.total}
                {fila.sinDato > 0 && (
                  <span className="text-slate-400" title={`${fila.sinDato} sin superficie cargada`}>
                    {" "}(−{fila.sinDato})
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
