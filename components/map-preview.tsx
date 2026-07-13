"use client";

import dynamic from "next/dynamic";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Layers3, MapPin, MapPinned, Minus, RotateCcw, Route, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { AdministrativeVisualStatus, AnalyzedCartel, FeatureCollection, GeoLine, GeoPoint, MainTerritorialFilter, TerritorialFilterState } from "@/data/territorial";
import { administrativeColors, administrativeLabels, initialTerritorialFilters } from "@/data/territorial";
import { CartelDetailPanel } from "./cartel-detail-panel";
import { MapAsk } from "./map-ask";

const CarteleriaMap = dynamic(() => import("./carteleria-map"), { ssr: false, loading: () => <div className="grid h-full place-items-center bg-slate-100 text-sm font-semibold text-slate-400">Cargando capas territoriales…</div> });

type Props = { carteles: AnalyzedCartel[]; allCarteles: AnalyzedCartel[]; corridors: FeatureCollection<GeoLine>; allowedPlaces: FeatureCollection<GeoPoint>; filters: TerritorialFilterState; onFilters: (filters: TerritorialFilterState) => void; loading: boolean; error: string | null; onRetry: () => void; administrativeSource: "supabase" | "static"; linkedCount: number; selected: AnalyzedCartel | null; onSelect: (cartel: AnalyzedCartel | null) => void };
const quickFilters: { value: Exclude<MainTerritorialFilter, "todos">; label: string }[] = [
  { value: "habilitado", label: "Habilitados" },
  { value: "deuda", label: "Con deuda" },
  { value: "fuera_corredor", label: "Fuera de zona" },
  { value: "no_registrado", label: "No registrados" }
];

export function MapPreview({ carteles, allCarteles, corridors, allowedPlaces, filters, onFilters, loading, error, onRetry, administrativeSource, linkedCount, selected, onSelect }: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [legendMinimized, setLegendMinimized] = useState(false);
  const inside = allCarteles.filter(item => item.properties.analysisStatus === "dentro_corredor").length;
  const outside = allCarteles.filter(item => item.properties.analysisStatus === "fuera_zona_permitida").length;
  const review = allCarteles.filter(item => item.properties.analysisStatus === "cerca_lugar_permitido").length;
  const outsidePercent = allCarteles.length ? Math.round(outside / allCarteles.length * 100) : 0;
  const advancedCount = filters.tax.length + filters.registry.length + filters.enablement.length + filters.support.length;
  useEffect(() => { if (selected && !carteles.some(item => item.properties.id === selected.properties.id)) onSelect(null); }, [carteles, selected, onSelect]);

  return <section id="mapa" className="section-block isolate">
    <div className="section-heading"><div><span className="section-kicker">Vista territorial</span><h2>Mapa de corredores y carteles</h2><p>Filtros de diagnóstico para priorizar tareas de control.</p></div><div className="flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-2 rounded-xl bg-municipal-50 px-4 py-2 text-xs font-bold text-municipal-700"><Layers3 size={15}/>{carteles.length} carteles visibles</span>{administrativeSource === "supabase" && <span className="rounded-xl bg-blue-50 px-3 py-2 text-[9px] font-bold text-blue-700">{linkedCount} vinculados con Supabase</span>}</div></div>

    <div data-tour="diagnostico" className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="grid size-7 place-items-center rounded-lg bg-municipal-50 text-municipal-700"><MapPinned size={14}/></span><b className="text-xs text-ink">Diagnóstico territorial</b></div><span className="hidden text-[9px] font-semibold text-slate-400 sm:block">Seleccioná un indicador para filtrar</span></div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><Metric active={filters.main.length === 0} onClick={() => onFilters({ ...filters, main: [] })} icon={<MapPin size={17}/>} tone="blue" value={allCarteles.length} label="Total de carteles"/><Metric active={filters.main.includes("dentro_corredor")} onClick={() => onFilters({ ...filters, main: ["dentro_corredor"] })} icon={<CheckCircle2 size={17}/>} tone="green" value={inside} label="Dentro de corredores"/><Metric active={filters.main.includes("fuera_corredor")} onClick={() => onFilters({ ...filters, main: ["fuera_corredor"] })} icon={<AlertTriangle size={17}/>} tone="red" value={outside} label="Fuera de zona permitida"/><Metric active={filters.main.includes("fuera_corredor")} onClick={() => onFilters({ ...filters, main: ["fuera_corredor"] })} icon={<Route size={17}/>} tone="yellow" value={`${outsidePercent}%`} label="Porcentaje fuera de zona"/></div></div>
    <div data-tour="map-ask"><MapAsk carteles={allCarteles} onApply={onFilters}/></div>
    <div data-tour="map-canvas" className="relative h-[72svh] min-h-[520px] overflow-hidden rounded-[22px] border border-slate-200 bg-slate-100 shadow-card sm:h-[650px] sm:rounded-[26px]">
      <CarteleriaMap carteles={carteles} corridors={corridors} allowedPlaces={allowedPlaces} selected={selected} onSelect={onSelect}/>
      <QuickFilters filters={filters} onFilters={onFilters} advancedOpen={advancedOpen} onAdvancedOpen={() => setAdvancedOpen(value => !value)} advancedCount={advancedCount}/>
      <AdministrativeLegend minimized={legendMinimized} onMinimize={() => setLegendMinimized(value => !value)}/>
      <div className="absolute right-5 top-5 z-[500] hidden rounded-xl bg-white/95 px-4 py-2 text-[10px] font-semibold text-slate-500 shadow-lg sm:block">{corridors.features.length} corredores · {review} a revisar</div>
      {loading && <div className="absolute inset-0 z-[700] grid place-items-center bg-white/65 backdrop-blur-sm"><div className="rounded-2xl bg-white px-5 py-4 text-center shadow-xl"><span className="mx-auto block size-6 animate-spin rounded-full border-2 border-municipal-100 border-t-municipal-700"/><b className="mt-3 block text-xs text-ink">Cargando territorio</b></div></div>}
      {error && <div className="absolute inset-0 z-[700] grid place-items-center bg-white/75 p-6 backdrop-blur-sm"><div className="max-w-sm rounded-2xl border border-red-100 bg-white p-5 text-center shadow-xl"><AlertTriangle className="mx-auto text-red-500"/><b className="mt-3 block text-sm text-ink">No pudimos mostrar el mapa</b><p className="mt-1 text-xs text-slate-500">{error}</p><button onClick={onRetry} className="primary-button compact mt-4">Reintentar</button></div></div>}
      {selected && <CartelDetailPanel cartel={selected} onClose={() => onSelect(null)}/>}
    </div>
  </section>;
}

function QuickFilters({ filters, onFilters, advancedOpen, onAdvancedOpen, advancedCount }: { filters: TerritorialFilterState; onFilters: (filters: TerritorialFilterState) => void; advancedOpen: boolean; onAdvancedOpen: () => void; advancedCount: number }) {
  const toggleMain = (value: Exclude<MainTerritorialFilter, "todos">) => onFilters({ ...filters, main: filters.main.includes(value) ? filters.main.filter(item => item !== value) : [...filters.main, value] });
  return <div className="absolute left-3 top-3 z-[500] max-h-[calc(100%-1.5rem)] w-[min(620px,calc(100%-1.5rem))] overflow-y-auto rounded-2xl border border-white/80 bg-white/90 p-2.5 shadow-lg backdrop-blur-md sm:left-5 sm:top-5 sm:w-auto sm:max-w-[620px]">
    <div className="mb-2 flex items-center justify-between gap-3 px-1"><span className="text-[9px] font-extrabold uppercase tracking-[.14em] text-slate-400">Filtrar carteles</span><span className="text-[8px] font-semibold text-slate-400">Selección múltiple</span></div>
    <label className="mb-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-white/90 px-3 py-2 focus-within:border-municipal-400 focus-within:ring-2 focus-within:ring-municipal-100"><Search size={14} className="shrink-0 text-slate-400"/><input value={filters.query} onChange={(event) => onFilters({ ...filters, query: event.target.value })} placeholder="Dirección, empresa, corredor o ID…" className="min-w-0 flex-1 bg-transparent text-[11px] font-semibold text-slate-700 outline-none placeholder:text-slate-400"/>{filters.query && <button type="button" onClick={() => onFilters({ ...filters, query: "" })} aria-label="Limpiar búsqueda" className="text-slate-400 hover:text-municipal-700"><X size={13}/></button>}</label>
    <div className="flex gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
      <button aria-pressed={filters.main.length === 0} onClick={() => onFilters({ ...filters, main: [] })} className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-2 text-[9px] font-extrabold transition ${filters.main.length === 0 ? "border-municipal-700 bg-municipal-700 text-white shadow-sm" : "border-slate-200 bg-white/85 text-slate-600"}`}>{filters.main.length === 0 && <Check size={11}/>}Todos</button>
      {quickFilters.map(option => { const active = filters.main.includes(option.value); return <button key={option.value} aria-pressed={active} onClick={() => toggleMain(option.value)} className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-2 text-[9px] font-extrabold transition ${active ? "border-municipal-700 bg-municipal-700 text-white shadow-sm" : "border-slate-200 bg-white/85 text-slate-600 hover:border-municipal-300 hover:text-municipal-700"}`}>{active && <Check size={11}/>} {option.label}</button>; })}
      <button onClick={onAdvancedOpen} aria-expanded={advancedOpen} className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-2 text-[9px] font-extrabold ${advancedOpen || advancedCount ? "border-municipal-300 bg-municipal-50 text-municipal-700" : "border-slate-200 bg-white/85 text-slate-600"}`}><SlidersHorizontal size={11}/>Avanzados{advancedCount > 0 && <span className="grid size-4 place-items-center rounded-full bg-municipal-700 text-[8px] text-white">{advancedCount}</span>}<ChevronDown size={10} className={advancedOpen ? "rotate-180" : ""}/></button>
    </div>
    <ActiveFilterSummary filters={filters} onFilters={onFilters}/>
    {advancedOpen && <AdvancedFilters filters={filters} onFilters={onFilters}/>}
  </div>;
}

function AdministrativeLegend({ minimized, onMinimize }: { minimized: boolean; onMinimize: () => void }) {
  const statuses: AdministrativeVisualStatus[] = ["habilitado", "deuda", "fuera_zona", "no_registrado"];
  return <div className="absolute bottom-5 right-14 z-[500] rounded-xl border border-white/80 bg-white/90 p-2.5 shadow-lg backdrop-blur-md sm:right-16">
    <button onClick={onMinimize} className="flex w-full items-center justify-between gap-3 text-[8px] font-extrabold uppercase tracking-wider text-slate-400" aria-expanded={!minimized}><span>Situación administrativa</span>{minimized ? <ChevronDown size={12}/> : <Minus size={12}/>}</button>
    {!minimized && <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-1">{statuses.map(status => <LegendDot key={status} color={administrativeColors[status]} label={administrativeLabels[status]}/>)}</div>}
  </div>;
}

function AdvancedFilters({ filters, onFilters }: { filters: TerritorialFilterState; onFilters: (filters: TerritorialFilterState) => void }) {
  return <div className="mt-3 border-t border-slate-200/80 pt-3"><div className="grid max-h-64 gap-3 overflow-y-auto pr-1 sm:grid-cols-2"><FilterGroup label="Estado tributario" values={filters.tax} onChange={tax => onFilters({ ...filters, tax: tax as TerritorialFilterState["tax"] })} options={[['paga','Paga'],['no_paga','No paga'],['deuda','Con deuda'],['sin_datos','Sin datos']]}/><FilterGroup label="Estado registral" values={filters.registry} onChange={registry => onFilters({ ...filters, registry: registry as TerritorialFilterState["registry"] })} options={[['registrado','Registrado'],['no_registrado','No registrado'],['incompleto','Incompleto'],['sin_datos','Sin datos']]}/><FilterGroup label="Habilitación" values={filters.enablement} onChange={enablement => onFilters({ ...filters, enablement: enablement as TerritorialFilterState["enablement"] })} options={[['habilitado','Habilitado'],['habilitable','Habilitable'],['no_habilitable','No habilitable'],['requiere_revision','Requiere revisión']]}/><FilterGroup label="Tipo de soporte" values={filters.support} onChange={support => onFilters({ ...filters, support: support as TerritorialFilterState["support"] })} options={[['led','LED'],['cartel_tradicional','Cartel tradicional'],['medianera','Medianera'],['cerca_obra','Cerca de obra'],['gigantografia','Gigantografía']]}/></div><button onClick={() => onFilters(initialTerritorialFilters)} className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold text-slate-400 hover:text-municipal-700"><RotateCcw size={12}/>Limpiar todos los filtros</button></div>;
}

function FilterGroup({ label, values, options, onChange }: { label: string; values: string[]; options: [string,string][]; onChange: (values: string[]) => void }) { return <fieldset><legend className="mb-1.5 text-[8px] font-extrabold uppercase tracking-wider text-slate-400">{label}</legend><div className="flex flex-wrap gap-1">{options.map(([value, optionLabel]) => { const active = values.includes(value); return <button type="button" key={value} aria-pressed={active} onClick={() => onChange(active ? values.filter(item => item !== value) : [...values, value])} className={`rounded-lg border px-2 py-1.5 text-[8px] font-bold transition ${active ? "border-municipal-600 bg-municipal-600 text-white" : "border-slate-200 bg-white/80 text-slate-600 hover:border-municipal-300"}`}>{active && <Check size={9} className="mr-1 inline"/>}{optionLabel}</button>; })}</div></fieldset>; }
function ActiveFilterSummary({ filters, onFilters }: { filters: TerritorialFilterState; onFilters: (filters: TerritorialFilterState) => void }) {
  const labels: Record<string, string> = { habilitado: "Habilitados", deuda: "Con deuda", fuera_corredor: "Fuera de zona", dentro_corredor: "Dentro de corredor", no_registrado: "No registrados", no_paga: "No paga", habilitable: "Habilitable", no_habilitable: "No habilitable", prioridad_alta: "Prioridad alta", zona_sensible: "Zona sensible", paga: "Paga", sin_datos: "Sin datos", registrado: "Registrado", incompleto: "Incompleto", requiere_revision: "Requiere revisión", led: "LED", cartel_tradicional: "Tradicional", medianera: "Medianera", cerca_obra: "Cerca de obra", gigantografia: "Gigantografía" };
  const chips = [
    ...(filters.query ? [{ id: "query", label: `“${filters.query}”`, remove: () => onFilters({ ...filters, query: "" }) }] : []),
    ...filters.main.map((value) => ({ id: `main-${value}`, label: labels[value] || value, remove: () => onFilters({ ...filters, main: filters.main.filter((item) => item !== value) }) })),
    ...filters.tax.map((value) => ({ id: `tax-${value}`, label: labels[value] || value, remove: () => onFilters({ ...filters, tax: filters.tax.filter((item) => item !== value) }) })),
    ...filters.registry.map((value) => ({ id: `registry-${value}`, label: labels[value] || value, remove: () => onFilters({ ...filters, registry: filters.registry.filter((item) => item !== value) }) })),
    ...filters.enablement.map((value) => ({ id: `enablement-${value}`, label: labels[value] || value, remove: () => onFilters({ ...filters, enablement: filters.enablement.filter((item) => item !== value) }) })),
    ...filters.support.map((value) => ({ id: `support-${value}`, label: labels[value] || value, remove: () => onFilters({ ...filters, support: filters.support.filter((item) => item !== value) }) })),
  ];
  if (!chips.length) return null;
  return <div className="mt-2 border-t border-slate-200/70 pt-2"><div className="flex items-center justify-between gap-3"><span className="text-[9px] font-bold text-municipal-700">{chips.length} {chips.length === 1 ? "criterio activo" : "criterios activos"}</span><button type="button" onClick={() => onFilters(initialTerritorialFilters)} className="inline-flex items-center gap-1 text-[9px] font-bold text-slate-400 hover:text-municipal-700"><RotateCcw size={10}/>Limpiar</button></div><div className="mt-1.5 flex flex-wrap gap-1">{chips.map((chip) => <button type="button" key={chip.id} onClick={chip.remove} title="Quitar filtro" className="inline-flex items-center gap-1 rounded-full bg-municipal-50 px-2 py-1 text-[8px] font-bold text-municipal-700 hover:bg-municipal-100">{chip.label}<X size={9}/></button>)}</div></div>;
}
function Metric({ icon, tone, value, label, active, onClick }: { icon: ReactNode; tone: "blue" | "green" | "red" | "yellow"; value: number | string; label: string; active: boolean; onClick: () => void }) { const tones = { blue: "bg-blue-50 text-blue-600", green: "bg-green-50 text-green-600", red: "bg-red-50 text-red-600", yellow: "bg-yellow-50 text-yellow-700" }; return <button type="button" aria-pressed={active} onClick={onClick} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${tones[tone]} ${active ? "ring-2 ring-current ring-offset-1" : ""}`}>{icon}<span><strong className="block text-sm text-ink">{value}</strong><span className="text-[9px] font-semibold text-slate-500">{label}</span></span></button>; }
function LegendDot({ color, label }: { color: string; label: string }) { return <span className="flex items-center gap-2 text-[10px] font-bold text-slate-600"><i className="size-3 rounded-full ring-2 ring-white shadow-sm" style={{ background: color }}/>{label}</span>; }
