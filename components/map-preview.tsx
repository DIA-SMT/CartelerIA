"use client";

import dynamic from "next/dynamic";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ExternalLink, Layers3, MapPin, MapPinned, Minus, RotateCcw, Route, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { AdministrativeVisualStatus, AnalyzedCartel, FeatureCollection, GeoLine, GeoPoint, MainTerritorialFilter, TerritorialFilterState } from "@/data/territorial";
import { administrativeColors, administrativeLabels, getAdministrativeVisualStatus, initialTerritorialFilters } from "@/data/territorial";

const CarteleriaMap = dynamic(() => import("./carteleria-map"), { ssr: false, loading: () => <div className="grid h-full place-items-center bg-slate-100 text-sm font-semibold text-slate-400">Cargando capas territoriales…</div> });

type Props = { carteles: AnalyzedCartel[]; allCarteles: AnalyzedCartel[]; corridors: FeatureCollection<GeoLine>; allowedPlaces: FeatureCollection<GeoPoint>; filters: TerritorialFilterState; onFilters: (filters: TerritorialFilterState) => void };
const quickFilters: { value: Exclude<MainTerritorialFilter, "todos">; label: string }[] = [
  { value: "habilitado", label: "Habilitados" },
  { value: "deuda", label: "Con deuda" },
  { value: "fuera_corredor", label: "Fuera de zona" },
  { value: "no_registrado", label: "No registrados" }
];

export function MapPreview({ carteles, allCarteles, corridors, allowedPlaces, filters, onFilters }: Props) {
  const [selected, setSelected] = useState<AnalyzedCartel | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [legendMinimized, setLegendMinimized] = useState(false);
  const inside = allCarteles.filter(item => item.properties.analysisStatus === "dentro_corredor").length;
  const outside = allCarteles.filter(item => item.properties.analysisStatus === "fuera_zona_permitida").length;
  const review = allCarteles.filter(item => item.properties.analysisStatus === "cerca_lugar_permitido").length;
  const outsidePercent = allCarteles.length ? Math.round(outside / allCarteles.length * 100) : 0;
  const advancedCount = filters.tax.length + filters.registry.length + filters.enablement.length + filters.support.length;
  useEffect(() => { if (selected && !carteles.some(item => item.properties.id === selected.properties.id)) setSelected(null); }, [carteles, selected]);

  return <section id="mapa" className="section-block isolate">
    <div className="section-heading"><div><span className="section-kicker">Vista territorial</span><h2>Mapa de corredores y carteles</h2><p>Filtros de diagnóstico para priorizar tareas de control.</p></div><span className="inline-flex items-center gap-2 rounded-xl bg-municipal-50 px-4 py-2 text-xs font-bold text-municipal-700"><Layers3 size={15}/>{carteles.length} carteles visibles</span></div>

    <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center gap-2"><span className="grid size-7 place-items-center rounded-lg bg-municipal-50 text-municipal-700"><MapPinned size={14}/></span><b className="text-xs text-ink">Diagnóstico territorial</b></div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={<MapPin size={17}/>} tone="blue" value={allCarteles.length} label="Total de carteles"/><Metric icon={<CheckCircle2 size={17}/>} tone="green" value={inside} label="Dentro de corredores"/><Metric icon={<AlertTriangle size={17}/>} tone="red" value={outside} label="Fuera de zona permitida"/><Metric icon={<Route size={17}/>} tone="yellow" value={`${outsidePercent}%`} label="Porcentaje fuera de zona"/></div></div>
    <div className="relative h-[650px] overflow-hidden rounded-[26px] border border-slate-200 bg-slate-100 shadow-card">
      <CarteleriaMap carteles={carteles} corridors={corridors} allowedPlaces={allowedPlaces} selected={selected} onSelect={setSelected}/>
      <QuickFilters filters={filters} onFilters={onFilters} advancedOpen={advancedOpen} onAdvancedOpen={() => setAdvancedOpen(value => !value)} advancedCount={advancedCount}/>
      <AdministrativeLegend minimized={legendMinimized} onMinimize={() => setLegendMinimized(value => !value)}/>
      <div className="absolute right-5 top-5 z-[500] hidden rounded-xl bg-white/95 px-4 py-2 text-[10px] font-semibold text-slate-500 shadow-lg sm:block">{corridors.features.length} corredores · {review} a revisar</div>
      {selected && <Detail cartel={selected} onClose={() => setSelected(null)}/>}
    </div>
  </section>;
}

function QuickFilters({ filters, onFilters, advancedOpen, onAdvancedOpen, advancedCount }: { filters: TerritorialFilterState; onFilters: (filters: TerritorialFilterState) => void; advancedOpen: boolean; onAdvancedOpen: () => void; advancedCount: number }) {
  const toggleMain = (value: Exclude<MainTerritorialFilter, "todos">) => onFilters({ ...filters, main: filters.main.includes(value) ? filters.main.filter(item => item !== value) : [...filters.main, value] });
  return <div className="absolute left-3 top-3 z-[500] max-h-[calc(100%-1.5rem)] w-[min(620px,calc(100%-1.5rem))] overflow-y-auto rounded-2xl border border-white/80 bg-white/90 p-2.5 shadow-lg backdrop-blur-md sm:left-5 sm:top-5 sm:w-auto sm:max-w-[620px]">
    <div className="mb-2 flex items-center justify-between gap-3 px-1"><span className="text-[9px] font-extrabold uppercase tracking-[.14em] text-slate-400">Filtrar carteles</span><span className="text-[8px] font-semibold text-slate-400">Selección múltiple</span></div>
    <div className="flex gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
      <button aria-pressed={filters.main.length === 0} onClick={() => onFilters({ ...filters, main: [] })} className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-2 text-[9px] font-extrabold transition ${filters.main.length === 0 ? "border-municipal-700 bg-municipal-700 text-white shadow-sm" : "border-slate-200 bg-white/85 text-slate-600"}`}>{filters.main.length === 0 && <Check size={11}/>}Todos</button>
      {quickFilters.map(option => { const active = filters.main.includes(option.value); return <button key={option.value} aria-pressed={active} onClick={() => toggleMain(option.value)} className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-2 text-[9px] font-extrabold transition ${active ? "border-municipal-700 bg-municipal-700 text-white shadow-sm" : "border-slate-200 bg-white/85 text-slate-600 hover:border-municipal-300 hover:text-municipal-700"}`}>{active && <Check size={11}/>} {option.label}</button>; })}
      <button onClick={onAdvancedOpen} aria-expanded={advancedOpen} className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-2 text-[9px] font-extrabold ${advancedOpen || advancedCount ? "border-municipal-300 bg-municipal-50 text-municipal-700" : "border-slate-200 bg-white/85 text-slate-600"}`}><SlidersHorizontal size={11}/>Avanzados{advancedCount > 0 && <span className="grid size-4 place-items-center rounded-full bg-municipal-700 text-[8px] text-white">{advancedCount}</span>}<ChevronDown size={10} className={advancedOpen ? "rotate-180" : ""}/></button>
    </div>
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
function Metric({ icon, tone, value, label }: { icon: ReactNode; tone: "blue" | "green" | "red" | "yellow"; value: number | string; label: string }) { const tones = { blue: "bg-blue-50 text-blue-600", green: "bg-green-50 text-green-600", red: "bg-red-50 text-red-600", yellow: "bg-yellow-50 text-yellow-700" }; return <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${tones[tone]}`}>{icon}<div><strong className="block text-sm text-ink">{value}</strong><span className="text-[9px] font-semibold text-slate-500">{label}</span></div></div>; }
function LegendDot({ color, label }: { color: string; label: string }) { return <span className="flex items-center gap-2 text-[10px] font-bold text-slate-600"><i className="size-3 rounded-full ring-2 ring-white shadow-sm" style={{ background: color }}/>{label}</span>; }
function Detail({ cartel, onClose }: { cartel: AnalyzedCartel; onClose: () => void }) {
  const [streetPreview, setStreetPreview] = useState(false);
  const googleMapsEmbedKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY;
  const [longitude, latitude] = cartel.geometry.coordinates;
  const p = cartel.properties;
  const visualStatus = getAdministrativeVisualStatus(cartel);
  const maps = `https://www.google.com/maps?q=${latitude},${longitude}`;
  const street = `https://www.google.com/maps?q=&layer=c&cbll=${latitude},${longitude}`;
  const streetEmbed = googleMapsEmbedKey ? `https://www.google.com/maps/embed/v1/streetview?key=${encodeURIComponent(googleMapsEmbedKey)}&location=${latitude},${longitude}&radius=100&source=outdoor` : null;
  return <aside className="absolute right-3 top-3 z-[600] max-h-[calc(100%-1.5rem)] w-[min(410px,calc(100%-1.5rem))] overflow-y-auto rounded-2xl border border-white bg-white/95 p-5 shadow-2xl backdrop-blur sm:right-5 sm:top-5 sm:max-h-[calc(100%-2.5rem)] sm:w-[min(410px,calc(100%-40px))]">
    <button onClick={onClose} className="absolute right-3 top-3 grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Cerrar detalle"><X size={17}/></button>
    <span className="inline-flex rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase text-white" style={{ background: administrativeColors[visualStatus] }}>{administrativeLabels[visualStatus]}</span>
    <h3 className="mt-3 pr-7 font-display text-lg font-extrabold text-ink">{p.name || "Cartel relevado"}</h3>
    <div className="mt-3 flex flex-wrap gap-1.5"><Tag text={p.taxStatus.replace('_',' ')}/><Tag text={p.registryStatus.replace('_',' ')}/><Tag text={p.enablementStatus.replace('_',' ')}/><Tag text={`Prioridad ${p.controlPriority}`}/></div>
    <dl className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-3 text-xs"><div><dt className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Corredor más cercano</dt><dd className="mt-1 font-semibold text-slate-700">{p.nearestCorridor || "Sin referencia"}</dd></div><div><dt className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Distancia</dt><dd className="mt-1 font-semibold text-slate-700">{Math.round(Number(p.distanceToCorridorM || 0))} metros</dd></div></dl>
    {p.analysisStatus !== "dentro_corredor" && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-[10px] font-semibold text-amber-800">Requiere evaluación administrativa. Potencial regularización o posible retiro según corresponda.</p>}
    {streetPreview && <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-100"><div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2"><b className="text-[10px] text-ink">Street View de esta ubicación</b><button onClick={() => setStreetPreview(false)} className="text-[9px] font-bold text-slate-400 hover:text-municipal-700">Ocultar</button></div>{streetEmbed ? <iframe title={`Street View de ${p.name || "cartel relevado"}`} src={streetEmbed} className="h-64 w-full border-0" loading="lazy" allowFullScreen referrerPolicy="no-referrer-when-downgrade"/> : <div className="grid h-48 place-items-center px-6 text-center"><div><MapPinned size={26} className="mx-auto text-municipal-600"/><b className="mt-3 block text-xs text-ink">Falta habilitar Google Street View</b><p className="mt-1 text-[10px] leading-4 text-slate-500">Configurá la clave de Maps Embed API para cargar la fotografía panorámica de esta ubicación.</p></div></div>}</div>}
    <div className="mt-4 grid grid-cols-2 gap-2"><a href={maps} target="_blank" rel="noreferrer" className="secondary-button compact justify-center">Google Maps <ExternalLink size={12}/></a><button onClick={() => setStreetPreview(value => !value)} className="primary-button compact justify-center">{streetPreview ? "Cerrar vista" : "Ver Street View"}</button></div>
    {streetPreview && <a href={street} target="_blank" rel="noreferrer" className="secondary-button compact mt-2 w-full justify-center">Ver en Google Street <ExternalLink size={12}/></a>}
  </aside>;
}
function Tag({ text }: { text: string }) { return <span className="rounded-full bg-slate-100 px-2 py-1 text-[8px] font-bold capitalize text-slate-600">{text}</span>; }
