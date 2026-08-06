"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Database } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { loadResumenCorpus, type ResumenCorpus } from "@/lib/configuracion-repository";

type LoadPhase = "idle" | "loading" | "ready" | "error";

function huella(valor: string | null): string {
  if (!valor) return "sin huella";
  return `${valor.slice(0, 10)}…${valor.slice(-6)}`;
}

/**
 * Estado del corpus documental, de solo lectura.
 *
 * La reingesta se sigue haciendo por script: no hay ningún botón acá que la
 * dispare. Esta pantalla responde de dónde salió cada documento y con qué
 * huella, que es lo que hace falta para sostener una cita ante una autoridad.
 */
export function TabCorpus() {
  const auth = useAuth();
  const [resumen, setResumen] = useState<ResumenCorpus | null>(null);
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataOwnerId, setDataOwnerId] = useState<string | null>(null);
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setLoadPhase("loading");
    setDataOwnerId(null);
    const result = await loadResumenCorpus();
    if (sequence !== refreshSequence.current) return;
    setDataOwnerId(auth.user?.id ?? null);
    setResumen(result.data);
    setLoadError(result.ok ? null : result.error);
    setLoadPhase(result.ok && result.data ? "ready" : "error");
  }, [auth.user?.id]);

  useEffect(() => {
    void refresh();
    return () => { refreshSequence.current += 1; };
  }, [refresh]);

  const ownsData = dataOwnerId === auth.user?.id;

  if (!ownsData || loadPhase === "loading" || loadPhase === "idle") {
    return (
      <div className="space-y-2" aria-label="Cargando corpus">
        <div className="skeleton h-20 rounded-2xl"/>
        <div className="skeleton h-40 rounded-2xl"/>
      </div>
    );
  }

  if (loadPhase === "error" || !resumen) {
    return (
      <div role="alert" className="empty-state border-red-200 bg-red-50">
        <span><AlertTriangle size={22}/></span>
        <h3>No se pudo leer el corpus</h3>
        <p>{loadError} Reintentá o revisá tu sesión.</p>
        <button type="button" onClick={refresh} className="secondary-button compact">Reintentar</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Resumen label="Documentos" valor={String(resumen.documentos)}/>
        <Resumen label="Fragmentos" valor={String(resumen.chunks)}/>
        <Resumen
          label="Contrato de ingesta"
          valor={resumen.contratoVersion === null ? "Sin dato" : `v${resumen.contratoVersion}`}
        />
        <Resumen
          label="Última ingesta"
          valor={resumen.ultimaIngesta
            ? new Date(resumen.ultimaIngesta).toLocaleDateString("es-AR")
            : "Sin dato"}
        />
      </div>

      <p className={`rounded-xl px-3 py-2.5 text-micro font-semibold leading-4 ${
        resumen.habilitadosIaExterna === 0
          ? "bg-green-50 text-green-800"
          : "bg-amber-50 text-amber-800"
      }`}>
        {resumen.habilitadosIaExterna === 0
          ? "Ningún documento está habilitado para IA externa: las consultas se resuelven con búsqueda léxica dentro de PostgreSQL."
          : `${resumen.habilitadosIaExterna} documento(s) habilitados para IA externa. Revisá que corresponda antes de una publicación.`}
      </p>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[820px] text-left text-tiny">
          <thead className="bg-slate-50">
            <tr className="micro-label">
              <th className="px-3 py-2.5">Documento</th>
              <th className="px-3 py-2.5 text-center">Frag.</th>
              <th className="px-3 py-2.5">Huella del PDF</th>
              <th className="px-3 py-2.5">Huella del texto</th>
              <th className="px-3 py-2.5">Estado</th>
            </tr>
          </thead>
          <tbody>
            {resumen.items.map((documento) => (
              <tr key={documento.id} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2">
                  <b className="block text-ink">{documento.titulo}</b>
                  <span className="text-micro text-slate-400">
                    {documento.categoria}
                    {documento.paginas ? ` · ${documento.paginas} pág.` : ""}
                  </span>
                </td>
                <td className="px-3 py-2 text-center font-bold text-slate-600">{documento.chunks}</td>
                <td className="px-3 py-2 font-mono text-micro text-slate-500">{huella(documento.hashPdf)}</td>
                <td className="px-3 py-2 font-mono text-micro text-slate-500">{huella(documento.hashTexto)}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <span className="badge-soft">
                      <i style={{ background: documento.audiencia === "publico" ? "#16a34a" : "#64748b" }}/>
                      {documento.audiencia === "publico" ? "Público" : "Interno"}
                    </span>
                    <span className="badge-soft">
                      <i style={{ background: documento.revisadoPorHumano ? "#16a34a" : "#f59e0b" }}/>
                      {documento.revisadoPorHumano ? "Revisado" : "Sin revisar"}
                    </span>
                    {documento.ocrDudoso && (
                      <span className="badge-soft">
                        <i style={{ background: "#f97316" }}/>
                        OCR dudoso
                      </span>
                    )}
                    {documento.iaExternaHabilitada && (
                      <span className="badge-soft">
                        <i style={{ background: "#dc2626" }}/>
                        IA externa
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="flex items-start gap-1.5 rounded-xl bg-slate-50 px-3 py-2 text-micro leading-4 text-slate-500">
        <Database size={12} className="mt-0.5 shrink-0"/>
        La reingesta se hace por script (<span className="font-mono">npm run ingest:docs</span>),
        no desde acá. Un documento sin revisión humana o con OCR dudoso no debería citarse como
        respaldo jurídico sin leer antes la fuente.
      </p>
    </div>
  );
}

function Resumen({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <span className="micro-label">{label}</span>
      <b className="mt-1 block font-display text-xl font-extrabold tracking-tight text-ink">{valor}</b>
    </div>
  );
}
