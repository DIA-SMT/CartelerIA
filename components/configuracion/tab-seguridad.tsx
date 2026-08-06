"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Database, Info, Lock } from "lucide-react";
import {
  AJUSTES_AUTENTICACION,
  MIGRACIONES_DECLARADAS,
  ORIGEN_LABELS,
  type OrigenDato,
} from "@/data/estado-sistema";
import { useAuth } from "@/hooks/use-auth";
import { loadEstadoBuckets, type EstadoBucket } from "@/lib/configuracion-repository";

type LoadPhase = "idle" | "loading" | "ready" | "error";

const ORIGEN_COLORS: Record<OrigenDato | "consultado", string> = {
  consultado: "#16a34a",
  verificado_manualmente: "#f59e0b",
  declarado_en_repositorio: "#64748b",
};

function fecha(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("es-AR");
}

function megabytes(bytes: number | null): string {
  if (bytes === null) return "sin límite declarado";
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * Estado del sistema, de solo lectura.
 *
 * Separa deliberadamente lo comprobable de lo declarado. Los buckets se leen en
 * vivo; la configuración del panel de Supabase no se puede consultar por API y
 * se muestra como verificada a mano, con su fecha; las migraciones son lo que
 * el repositorio contiene, no lo que la instancia corrió, porque no hay CLI ni
 * tabla de migraciones que lo registre.
 *
 * Presentar cualquiera de las tres cosas como si fuera la otra sería
 * exactamente el tipo de dato simulado que el roadmap prohíbe.
 */
export function TabSeguridad() {
  const auth = useAuth();
  const [buckets, setBuckets] = useState<EstadoBucket[]>([]);
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataOwnerId, setDataOwnerId] = useState<string | null>(null);
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setLoadPhase("loading");
    setDataOwnerId(null);
    const result = await loadEstadoBuckets();
    if (sequence !== refreshSequence.current) return;
    setDataOwnerId(auth.user?.id ?? null);
    setBuckets(result.data);
    setLoadError(result.ok ? null : result.error);
    setLoadPhase(result.ok ? "ready" : "error");
  }, [auth.user?.id]);

  useEffect(() => {
    void refresh();
    return () => { refreshSequence.current += 1; };
  }, [refresh]);

  const ownsData = dataOwnerId === auth.user?.id;

  return (
    <div className="space-y-5">
      <p className="max-w-2xl text-tiny leading-5 text-slate-500">
        Cada dato indica de dónde sale. Lo que se puede consultar se lee en vivo; lo que
        depende del panel de Supabase se muestra como verificado a mano, con la fecha de esa
        verificación. Nada figura como comprobado si no lo está.
      </p>

      {/* Buckets: esto sí se consulta */}
      <section>
        <h3 className="micro-label">Evidencia · consultado en vivo</h3>
        {!ownsData || loadPhase === "loading" || loadPhase === "idle" ? (
          <div className="mt-2 space-y-2">
            <div className="skeleton h-16 rounded-xl"/>
            <div className="skeleton h-16 rounded-xl"/>
          </div>
        ) : loadPhase === "error" ? (
          <div role="alert" className="mt-2 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-micro font-semibold leading-4 text-red-800">
            <AlertTriangle size={14} className="mt-0.5 shrink-0"/>
            <span>{loadError} No se puede afirmar el estado de los buckets sin poder leerlo.</span>
          </div>
        ) : (
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {buckets.map((bucket) => (
              <li key={bucket.bucket} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <b className="text-tiny text-ink">{bucket.bucket}</b>
                  <span className="badge-soft">
                    <i style={{ background: bucket.publico ? "#dc2626" : ORIGEN_COLORS.consultado }}/>
                    {bucket.publico ? "Público" : "Privado"}
                  </span>
                </div>
                <p className="mt-1.5 text-micro leading-4 text-slate-500">
                  Límite {megabytes(bucket.limiteBytes)} ·{" "}
                  {bucket.mimePermitidos.length > 0
                    ? bucket.mimePermitidos.join(", ")
                    : "sin restricción de tipo declarada"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Autenticación: esto no se puede consultar */}
      <section>
        <h3 className="micro-label">Autenticación · verificado a mano</h3>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {AJUSTES_AUTENTICACION.map((ajuste) => (
            <li key={ajuste.concepto} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <b className="text-tiny text-ink">{ajuste.concepto}</b>
                <span className="badge-soft shrink-0">
                  <i style={{ background: ORIGEN_COLORS[ajuste.origen] }}/>
                  {ajuste.valor}
                </span>
              </div>
              <p className="mt-1.5 text-micro leading-4 text-slate-500">{ajuste.detalle}</p>
              <p className="mt-1 text-micro font-semibold text-amber-700">
                {ORIGEN_LABELS[ajuste.origen]} el {fecha(ajuste.verificadoEn)}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-micro font-semibold leading-4 text-amber-800">
          <Info size={12} className="mt-0.5 shrink-0"/>
          Estos cuatro ajustes viven en el panel de Supabase y no se pueden consultar por API.
          Conviene revisarlos antes de cualquier publicación y actualizar la fecha.
        </p>
      </section>

      {/* Migraciones: declaradas, no comprobadas */}
      <section>
        <h3 className="micro-label">Migraciones · declaradas en el repositorio</h3>
        <p className="mt-1 flex items-start gap-1.5 rounded-xl bg-slate-50 px-3 py-2 text-micro leading-4 text-slate-500">
          <Lock size={12} className="mt-0.5 shrink-0"/>
          No hay CLI vinculado ni tabla de migraciones: la aplicación no puede saber cuáles se
          aplicaron. Esta lista es lo que el repositorio contiene. Ya pasó una vez que una
          migración quedara sin aplicar durante meses sin que nada lo avisara.
        </p>
        <div className="mt-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[520px] text-left text-tiny">
            <thead className="bg-slate-50">
              <tr className="micro-label">
                <th className="px-3 py-2.5">Nº</th>
                <th className="px-3 py-2.5">Archivo</th>
                <th className="px-3 py-2.5">Alcance</th>
              </tr>
            </thead>
            <tbody>
              {MIGRACIONES_DECLARADAS.map((migracion) => (
                <tr key={migracion.archivo} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-bold text-ink">{migracion.numero}</td>
                  <td className="px-3 py-2 font-mono text-micro text-slate-500">{migracion.archivo}</td>
                  <td className="px-3 py-2 text-slate-600">{migracion.resumen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="micro-label">Keepalive de Supabase</h3>
        <p className="mt-1 flex items-start gap-1.5 rounded-xl bg-slate-50 px-3 py-2 text-micro leading-4 text-slate-500">
          <Database size={12} className="mt-0.5 shrink-0"/>
          El ping diario lo ejecuta GitHub Actions y no deja registro en la base, así que la
          aplicación no puede mostrar la fecha del último. Se consulta en el historial del
          workflow <span className="font-mono">supabase-keepalive.yml</span>. Sirve para que el
          proyecto no se pause por inactividad; si el subdominio deja de resolver, sospechar
          de eso antes que de un problema de DNS.
        </p>
      </section>
    </div>
  );
}
