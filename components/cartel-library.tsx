"use client";

import { Check, MapPin, MapPinned, Route, Search, ShieldCheck, Signpost } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AdministrativeVisualStatus, AnalyzedCartel } from "@/data/territorial";
import { administrativeColors, administrativeLabels, getAdministrativeVisualStatus } from "@/data/territorial";

/** Estados administrativos filtrables (mismo criterio y colores que la leyenda del mapa). */
const STATUS_FILTERS: AdministrativeVisualStatus[] = ["habilitado", "deuda", "fuera_zona", "no_registrado"];

export function CartelLibrary({ carteles, onLocate }: { carteles: AnalyzedCartel[]; onLocate: (cartel: AnalyzedCartel) => void }) {
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<AdministrativeVisualStatus[]>([]);
  const [page, setPage] = useState(1);
  const pageSize = 12;
  const filtered = useMemo(() => carteles.filter(item => {
    const visualStatus = getAdministrativeVisualStatus(item);
    if (statuses.length > 0 && !statuses.includes(visualStatus)) return false;
    return `${item.properties.name || ""} ${item.properties.nearestCorridor || ""} ${administrativeLabels[visualStatus]}`.toLowerCase().includes(query.toLowerCase());
  }), [carteles, query, statuses]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => setPage(1), [carteles]);

  const toggleStatus = (status: AdministrativeVisualStatus) => {
    setStatuses(current => current.includes(status) ? current.filter(item => item !== status) : [...current, status]);
    setPage(1);
  };

  return <section id="carteles" className="section-block">
    <div className="section-heading"><div><span className="section-kicker">Prioridad de control</span><h2>Carteles analizados</h2><p>Resultados territoriales para orientar la revisión administrativa.</p></div><span className="text-xs font-bold text-slate-400">{filtered.length} registros</span></div>
    <label className="filter-input mb-3 max-w-xl border border-slate-200 bg-white"><Search size={16}/><input value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} aria-label="Buscar carteles analizados" placeholder="Buscar dirección, corredor o estado..."/></label>
    <div className="mb-6 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por situación administrativa">
      <button type="button" aria-pressed={statuses.length === 0} onClick={() => { setStatuses([]); setPage(1); }} className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-2 text-[9px] font-extrabold transition ${statuses.length === 0 ? "border-municipal-700 bg-municipal-700 text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-municipal-300 hover:text-municipal-700"}`}>{statuses.length === 0 && <Check size={11}/>}Todos</button>
      {STATUS_FILTERS.map(status => {
        const active = statuses.includes(status);
        return <button key={status} type="button" aria-pressed={active} onClick={() => toggleStatus(status)} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[9px] font-extrabold transition ${active ? "border-municipal-700 bg-municipal-700 text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-municipal-300 hover:text-municipal-700"}`}>
          <i className="size-2 rounded-full ring-1 ring-white/70" style={{ background: administrativeColors[status] }}/>{administrativeLabels[status]}
        </button>;
      })}
    </div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visible.map(item => {
      const status = item.properties.analysisStatus;
      const visualStatus = getAdministrativeVisualStatus(item);
      return <article key={String(item.properties.id)} className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-5 transition duration-200 hover:-translate-y-0.5 hover:border-municipal-500/40 hover:shadow-card">
        <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-municipal-50 text-municipal-700"><Signpost size={19}/></span><div className="min-w-0"><span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Cartel relevado</span><h3 className="mt-1 min-h-10 font-display text-sm font-extrabold leading-5 text-ink">{item.properties.name || "Dirección sin identificar"}</h3></div></div>
        <span className="mt-3 w-fit rounded-full px-2.5 py-1 text-[8px] font-extrabold uppercase tracking-wider text-white" style={{ background: administrativeColors[visualStatus] }}>{administrativeLabels[visualStatus]}</span>
        <div className="mt-2 flex flex-wrap gap-1.5"><span className="rounded-full bg-slate-100 px-2 py-1 text-[8px] font-bold capitalize text-slate-600">{item.properties.taxStatus.replace("_", " ")}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-[8px] font-bold capitalize text-slate-600">{item.properties.registryStatus.replace("_", " ")}</span><span className="rounded-full bg-municipal-50 px-2 py-1 text-[8px] font-bold capitalize text-municipal-700">{item.properties.enablementStatus.replace("_", " ")}</span></div>
        <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-3">
          <div className="flex items-start gap-2"><Route size={14} className="mt-0.5 shrink-0 text-municipal-700"/><div><span className="block text-[8px] font-bold uppercase tracking-wider text-slate-400">Corredor más cercano</span><p className="mt-1 text-[11px] font-semibold leading-4 text-slate-700">{item.properties.nearestCorridor || "Sin referencia"}</p></div></div>
          <div className="flex items-center gap-2"><MapPin size={14} className="shrink-0 text-municipal-700"/><span className="text-[10px] font-semibold text-slate-500">{Math.round(Number(item.properties.distanceToCorridorM || 0))} metros al corredor</span></div>
        </div>
        {status === "fuera_zona_permitida" && <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-[9px] font-bold text-red-700"><ShieldCheck size={13}/>Prioridad de control · requiere evaluación</div>}
        {status === "cerca_lugar_permitido" && <div className="mt-3 flex items-center gap-2 rounded-lg bg-yellow-50 px-3 py-2 text-[9px] font-bold text-yellow-800"><ShieldCheck size={13}/>A revisar por proximidad a lugar permitido</div>}
        <footer className="mt-auto border-t border-slate-100 pt-4"><button type="button" onClick={() => onLocate(item)} className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-municipal-700 px-2 text-[9px] font-bold text-white transition hover:bg-municipal-900"><MapPinned size={12}/>Ver en el mapa</button></footer>
      </article>;
    })}</div>
    {visible.length === 0 && <div className="empty-state"><span><Signpost size={24}/></span><h3>No hay carteles para este filtro</h3><p>Probá con otro estado de análisis o término de búsqueda.</p></div>}
    <div className="mt-7 flex items-center justify-center gap-3"><button disabled={currentPage === 1} onClick={() => setPage(value => value - 1)} className="secondary-button compact disabled:opacity-40">Anterior</button><span className="text-xs font-bold text-slate-400">Página {currentPage} de {totalPages}</span><button disabled={currentPage === totalPages} onClick={() => setPage(value => value + 1)} className="secondary-button compact disabled:opacity-40">Siguiente</button></div>
  </section>;
}
