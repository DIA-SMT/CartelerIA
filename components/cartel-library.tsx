"use client";

import { Crosshair, ExternalLink, ImageOff, MapPin, Search, Signpost } from "lucide-react";
import { useMemo, useState } from "react";
import type { CartelRecord, ContaminationLevel, SituationStatus } from "@/data/carteles";
import { cartelAddress, situationLabels } from "@/data/carteles";

const statusBadge: Record<SituationStatus, string> = {
  relevado: "bg-blue-50 text-blue-700", habilitado: "bg-green-50 text-green-700",
  pendiente: "bg-yellow-50 text-yellow-700", observado: "bg-orange-50 text-orange-700",
  infraccion: "bg-red-50 text-red-700", sin_datos: "bg-slate-100 text-slate-600"
};
const contaminationBadge: Record<ContaminationLevel, string> = {
  bajo: "bg-sky-50 text-sky-700", medio: "bg-yellow-50 text-yellow-700",
  alto: "bg-orange-50 text-orange-700", critico: "bg-red-50 text-red-700"
};

export function CartelLibrary({ carteles, onCorrect }: { carteles: CartelRecord[]; onCorrect: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 12;
  const filtered = useMemo(() => carteles.filter(item => `${item.empresa} ${item.domicilio} ${item.numero} ${item.tipoCartel}`.toLowerCase().includes(query.toLowerCase())), [carteles, query]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function startCorrection(id: string) {
    onCorrect(id);
    document.getElementById("mapa")?.scrollIntoView({ behavior: "smooth" });
  }

  return <section id="carteles" className="section-block">
    <div className="section-heading"><div><span className="section-kicker">Base de relevamiento</span><h2>Carteles identificados</h2><p>Direcciones importadas, situación visual y acceso a la vista de calle.</p></div><span className="text-xs font-bold text-slate-400">{filtered.length} registros</span></div>
    <label className="filter-input mb-6 max-w-xl border border-slate-200 bg-white"><Search size={16}/><input value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} aria-label="Buscar carteles" placeholder="Buscar empresa, domicilio o tipo de cartel..."/></label>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visible.map(item => {
      const mapped = item.latitud != null && item.longitud != null;
      const streetViewUrl = mapped ? `https://www.google.com/maps?q=&layer=c&cbll=${item.latitud},${item.longitud}` : null;
      return <article key={item.id} className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-5 transition duration-200 hover:-translate-y-0.5 hover:border-municipal-500/40 hover:shadow-card">
        <div className="flex items-start justify-between gap-3"><span className="grid size-10 place-items-center rounded-xl bg-municipal-50 text-municipal-700"><Signpost size={19}/></span><div className="flex flex-wrap justify-end gap-1.5"><span className={`rounded-full px-2.5 py-1 text-[8px] font-extrabold uppercase tracking-wider ${statusBadge[item.status]}`}>{situationLabels[item.status]}</span>{item.locationEdited && <span className="rounded-full bg-municipal-50 px-2.5 py-1 text-[8px] font-extrabold uppercase tracking-wider text-municipal-700">Ubicación corregida</span>}</div></div>
        <h3 className="mt-4 line-clamp-2 min-h-10 font-display text-sm font-extrabold leading-5 text-ink">{item.empresa || "Empresa sin identificar"}</h3>
        <p className="mt-2 flex min-h-10 items-start gap-2 text-xs leading-5 text-slate-500"><MapPin size={14} className="mt-0.5 shrink-0"/>{cartelAddress(item) || "Domicilio sin informar"}</p>
        <div className="mt-4 flex flex-wrap gap-2 text-[9px] font-bold"><span className={`rounded-md px-2 py-1 capitalize ${contaminationBadge[item.contaminationLevel]}`}>Contaminación {item.contaminationLevel === "critico" ? "crítica" : item.contaminationLevel}</span><span className="rounded-md bg-slate-50 px-2 py-1 text-slate-400">{item.tipoCartel}</span>{item.dimensiones && <span className="rounded-md bg-slate-50 px-2 py-1 text-slate-400">{item.dimensiones}</span>}</div>
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-100 bg-slate-50"><div className="flex h-24 items-center justify-center">{item.streetViewImageUrl ? <img src={item.streetViewImageUrl} alt={`Vista de calle de ${cartelAddress(item)}`} className="h-full w-full object-cover"/> : <div className="text-center text-slate-400"><ImageOff className="mx-auto" size={22}/><span className="mt-1 block text-[10px] font-semibold">Vista de calle no disponible</span></div>}</div><div className="flex items-center justify-between border-t border-slate-100 bg-white px-3 py-2"><b className="text-[9px] uppercase tracking-wider text-slate-400">Vista de calle</b>{streetViewUrl ? <a href={streetViewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold text-municipal-700">Abrir en Street View <ExternalLink size={11}/></a> : <span className="text-[9px] text-slate-300">Sin coordenadas</span>}</div></div>
        <footer className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-4">{item.googleMapsUrl?.startsWith("http") ? <a href={item.googleMapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-municipal-700">Google Maps <ExternalLink size={11}/></a> : <span/>}<button onClick={() => startCorrection(item.id)} className="inline-flex items-center gap-1.5 rounded-lg bg-municipal-700 px-3 py-2 text-[10px] font-bold text-white transition hover:bg-municipal-900"><Crosshair size={12}/>{mapped ? "Editar ubicación" : "Ubicar"}</button></footer>
      </article>;
    })}</div>
    {visible.length === 0 && <div className="empty-state"><span><Signpost size={24}/></span><h3>No hay carteles para este filtro</h3><p>Probá con otro nivel de contaminación o término de búsqueda.</p></div>}
    <div className="mt-7 flex items-center justify-center gap-3"><button disabled={currentPage === 1} onClick={() => setPage(value => value - 1)} className="secondary-button compact disabled:opacity-40">Anterior</button><span className="text-xs font-bold text-slate-400">Página {currentPage} de {totalPages}</span><button disabled={currentPage === totalPages} onClick={() => setPage(value => value + 1)} className="secondary-button compact disabled:opacity-40">Siguiente</button></div>
  </section>;
}
