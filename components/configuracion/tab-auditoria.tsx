"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  TIPOS_BITACORA,
  loadBitacora,
  type EntradaBitacora,
  type TipoBitacora,
} from "@/lib/configuracion-repository";

type LoadPhase = "idle" | "loading" | "ready" | "error";

const POR_PAGINA = 25;

const TIPO_COLORS: Record<TipoBitacora, string> = {
  inspeccion: "#0ea5e9",
  expediente: "#6366f1",
  vinculo: "#16a34a",
  rol: "#0166FF",
  acceso: "#f97316",
};

const TIPO_LABELS: Record<TipoBitacora, string> = {
  inspeccion: "Inspección",
  expediente: "Expediente",
  vinculo: "Vínculo",
  rol: "Rol",
  acceso: "Acceso",
};

/**
 * Bitácora unificada de solo lectura.
 *
 * El filtrado, el orden y el conteo total se resuelven en PostgreSQL: son cinco
 * tablas que solo crecen, y traerlas al navegador para paginar acá dejaría de
 * funcionar el día que el sistema se use de verdad.
 */
export function TabAuditoria() {
  const auth = useAuth();
  const [entradas, setEntradas] = useState<EntradaBitacora[]>([]);
  const [total, setTotal] = useState(0);
  const [tipos, setTipos] = useState<TipoBitacora[]>([]);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [pagina, setPagina] = useState(0);
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataOwnerId, setDataOwnerId] = useState<string | null>(null);
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setLoadPhase("loading");
    setLoadError(null);
    setDataOwnerId(null);
    const result = await loadBitacora({
      tipos,
      desde: desde || null,
      hasta: hasta || null,
      limite: POR_PAGINA,
      offset: pagina * POR_PAGINA,
    });
    if (sequence !== refreshSequence.current) return;
    setDataOwnerId(auth.user?.id ?? null);
    setEntradas(result.data.entradas);
    setTotal(result.data.total);
    setLoadError(result.ok ? null : result.error);
    setLoadPhase(result.ok ? "ready" : "error");
  }, [tipos, desde, hasta, pagina, auth.user?.id]);

  useEffect(() => {
    void refresh();
    return () => { refreshSequence.current += 1; };
  }, [refresh]);

  const alternarTipo = (tipo: TipoBitacora) => {
    setPagina(0);
    setTipos((actuales) => actuales.includes(tipo)
      ? actuales.filter((item) => item !== tipo)
      : [...actuales, tipo]);
  };

  const ownsData = dataOwnerId === auth.user?.id;
  const ultimaPagina = Math.max(0, Math.ceil(total / POR_PAGINA) - 1);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {TIPOS_BITACORA.map((item) => {
            const activo = tipos.includes(item.tipo);
            return (
              <button
                key={item.tipo}
                type="button"
                aria-pressed={activo}
                onClick={() => alternarTipo(item.tipo)}
                className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-micro font-extrabold transition duration-fast ${
                  activo
                    ? "border-municipal-600 bg-municipal-50 text-municipal-700"
                    : "border-slate-200 bg-white text-slate-500 hover:border-municipal-300"
                }`}
              >
                <i className="size-2 shrink-0 rounded-full" style={{ background: TIPO_COLORS[item.tipo] }}/>
                {item.label}
              </button>
            );
          })}
          {tipos.length > 0 && (
            <button
              type="button"
              onClick={() => { setTipos([]); setPagina(0); }}
              className="text-micro font-bold text-slate-400 underline underline-offset-2 hover:text-municipal-700"
            >
              Ver todo
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="micro-label">Desde</span>
            <input
              type="date"
              value={desde}
              onChange={(event) => { setDesde(event.target.value); setPagina(0); }}
              className="min-h-8 rounded-lg border border-slate-200 bg-white px-2 text-micro font-semibold text-slate-700 outline-none focus:border-municipal-500"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="micro-label">Hasta</span>
            <input
              type="date"
              value={hasta}
              onChange={(event) => { setHasta(event.target.value); setPagina(0); }}
              className="min-h-8 rounded-lg border border-slate-200 bg-white px-2 text-micro font-semibold text-slate-700 outline-none focus:border-municipal-500"
            />
          </label>
        </div>
      </div>

      {!ownsData || loadPhase === "loading" || loadPhase === "idle" ? (
        <TableSkeleton/>
      ) : loadPhase === "error" ? (
        <div role="alert" className="empty-state border-red-200 bg-red-50">
          <span><AlertTriangle size={22}/></span>
          <h3>No se pudo cargar la bitácora</h3>
          <p>{loadError} Reintentá o revisá tu sesión.</p>
          <button type="button" onClick={refresh} className="secondary-button compact">Reintentar</button>
        </div>
      ) : entradas.length === 0 ? (
        <div className="empty-state">
          <span><ScrollText size={22}/></span>
          <h3>Sin registros</h3>
          <p>No hay actuaciones que coincidan con el filtro seleccionado.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full min-w-[860px] text-left text-tiny">
              <thead className="bg-slate-50">
                <tr className="micro-label">
                  <th className="px-3 py-2.5">Fecha</th>
                  <th className="px-3 py-2.5">Tipo</th>
                  <th className="px-3 py-2.5">Actor</th>
                  <th className="px-3 py-2.5">Acción</th>
                  <th className="px-3 py-2.5">Recurso</th>
                  <th className="px-3 py-2.5">Fundamento</th>
                </tr>
              </thead>
              <tbody>
                {entradas.map((entrada, index) => (
                  <tr key={`${entrada.tipo}-${entrada.ocurridoEn}-${index}`} className="border-t border-slate-100 align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                      {new Date(entrada.ocurridoEn).toLocaleString("es-AR")}
                    </td>
                    <td className="px-3 py-2">
                      <span className="badge-soft">
                        <i style={{ background: TIPO_COLORS[entrada.tipo] }}/>
                        {TIPO_LABELS[entrada.tipo]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <b className="block text-ink">{entrada.actorNombre || "Sin identificar"}</b>
                      <span className="text-micro text-slate-400">{entrada.actorRol ?? "—"}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{entrada.accion}</td>
                    <td className="max-w-[200px] truncate px-3 py-2 text-slate-500" title={entrada.recurso}>
                      {entrada.recurso}
                    </td>
                    <td className="max-w-[260px] px-3 py-2 text-slate-500">
                      {entrada.fundamento ?? <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-micro font-semibold text-slate-400">
              {total} registro{total === 1 ? "" : "s"} · página {pagina + 1} de {ultimaPagina + 1}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPagina((valor) => Math.max(0, valor - 1))}
                disabled={pagina === 0}
                className="secondary-button compact disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Página anterior"
              >
                <ChevronLeft size={14}/>
              </button>
              <button
                type="button"
                onClick={() => setPagina((valor) => Math.min(ultimaPagina, valor + 1))}
                disabled={pagina >= ultimaPagina}
                className="secondary-button compact disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Página siguiente"
              >
                <ChevronRight size={14}/>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3" aria-label="Cargando bitácora">
      <div className="skeleton h-8 rounded-lg"/>
      <div className="skeleton h-9 rounded-lg"/>
      <div className="skeleton h-9 rounded-lg"/>
      <div className="skeleton h-9 rounded-lg"/>
    </div>
  );
}
