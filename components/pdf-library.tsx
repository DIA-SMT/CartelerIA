"use client";

import { CalendarDays, CheckCircle2, Clock3, FileText, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import type { DocumentCategory, UrbanDocument } from "@/data/documents";
import { documents } from "@/data/documents";

const categories = ["Todas", "Normativa", "Informe", "Relevamiento", "Proceso", "Nota"];
const categoryStyles: Record<DocumentCategory, string> = {
  Normativa: "bg-blue-50 text-blue-700",
  Informe: "bg-sky-50 text-sky-700",
  Proceso: "bg-amber-50 text-amber-700",
  Relevamiento: "bg-orange-50 text-orange-700",
  Nota: "bg-slate-100 text-slate-600"
};

export function PdfLibrary({ onOpen }: { onOpen: (document: UrbanDocument) => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todas");
  const visible = useMemo(() => documents.filter(item => (category === "Todas" || item.category === category) && `${item.title} ${item.description}`.toLowerCase().includes(query.toLowerCase())), [query, category]);

  return <section id="documentos" className="section-block">
    <span id="normativa" className="block scroll-mt-24"/>
    <div className="section-heading"><div><span className="section-kicker">Archivo digital</span><h2>Biblioteca de documentos</h2><p>Informes, normativa, relevamientos y procesos reunidos en un solo lugar.</p></div><span className="text-xs font-bold text-slate-400">{visible.length} documentos</span></div>
    <div className="mb-6 grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:grid-cols-[1fr_220px]"><label className="filter-input"><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} aria-label="Buscar documentos" placeholder="Buscar por título o contenido..."/></label><label className="filter-input"><SlidersHorizontal size={16}/><select value={category} onChange={event => setCategory(event.target.value)} aria-label="Filtrar por categoría" className="w-full bg-transparent text-xs font-semibold text-slate-600 outline-none">{categories.map(item => <option key={item}>{item}</option>)}</select></label></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visible.map(item => { const available = Boolean(item.pdfUrl); return <article key={item.id} className="group flex min-h-[260px] flex-col rounded-2xl border border-slate-200 bg-white p-5 transition duration-200 hover:-translate-y-0.5 hover:border-municipal-500/40 hover:shadow-card"><div className="flex items-start justify-between gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-municipal-50 text-municipal-700"><FileText size={20}/></span><div className="flex flex-wrap justify-end gap-1.5"><span className={`rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-wider ${categoryStyles[item.category]}`}>{item.category}</span><span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[9px] font-extrabold ${available ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"}`}>{available ? <CheckCircle2 size={10}/> : <Clock3 size={10}/>} {available ? "Disponible" : "Pendiente de carga"}</span></div></div><h3 className="mt-5 font-display text-base font-extrabold leading-6 text-ink">{item.title}</h3><p className="mt-2 flex-1 text-xs leading-5 text-slate-500">{item.description}</p><footer className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4"><span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400"><CalendarDays size={13}/>{new Intl.DateTimeFormat("es-AR", { month: "short", year: "numeric" }).format(new Date(`${item.date}T12:00:00`))}</span><button disabled={!available} onClick={() => available && onOpen(item)} className="rounded-lg bg-municipal-700 px-3 py-2 text-[11px] font-bold text-white transition hover:bg-municipal-900 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">{available ? "Ver PDF" : "Sin archivo"}</button></footer></article>; })}</div>
    {visible.length === 0 && <div className="empty-state"><span><FileText size={24}/></span><h3>No encontramos documentos</h3><p>Probá con otro término o categoría.</p></div>}
  </section>;
}
