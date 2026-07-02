"use client";

import dynamic from "next/dynamic";
import { Check, Crosshair, ExternalLink, Layers3, MapPin, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { CartelRecord } from "@/data/carteles";
import type { ContaminationLevel } from "@/data/carteles";
import { cartelAddress, situationColors, situationLabels } from "@/data/carteles";

const CarteleriaMap = dynamic(() => import("./carteleria-map"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center bg-slate-100 text-sm font-semibold text-slate-400">Cargando mapa urbano…</div>
});
const legend = Object.entries(situationLabels) as [keyof typeof situationLabels, string][];

type Props = {
  carteles: CartelRecord[];
  allCarteles: CartelRecord[];
  editingId: string | null;
  onEditingChange: (id: string | null) => void;
  onUpdate: (cartel: CartelRecord) => void;
  onReset: (id: string) => void;
  contaminationFilter: "todos" | ContaminationLevel;
  onContaminationFilter: (level: "todos" | ContaminationLevel) => void;
};

export function MapPreview({ carteles, allCarteles, editingId, onEditingChange, onUpdate, onReset, contaminationFilter, onContaminationFilter }: Props) {
  const editing = allCarteles.find(item => item.id === editingId) ?? null;
  const [selected, setSelected] = useState<CartelRecord | null>(null);
  const [domicilio, setDomicilio] = useState("");
  const [numero, setNumero] = useState("");
  const [draftLocation, setDraftLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const mapped = carteles.filter(item => item.latitud != null && item.longitud != null).length;

  useEffect(() => {
    if (!editing) return;
    setDomicilio(editing.domicilio);
    setNumero(editing.numero);
    setDraftLocation(editing.latitud != null && editing.longitud != null ? { latitude: editing.latitud, longitude: editing.longitud } : null);
    setSelected(editing);
  }, [editing]);

  function saveCorrection() {
    if (!editing || !draftLocation) return;
    const updated = { ...editing, domicilio: domicilio.trim(), numero: numero.trim(), latitud: draftLocation.latitude, longitud: draftLocation.longitude, locationSource: "manual" as const, locationEdited: true };
    onUpdate(updated);
    setSelected(updated);
    onEditingChange(null);
    setDraftLocation(null);
  }

  function resetLocation(cartel: CartelRecord) {
    onReset(cartel.id);
    onEditingChange(null);
    setDraftLocation(null);
    setSelected(null);
  }

  function restoreOriginalDraft() {
    if (!editing) return;
    setDomicilio(editing.domicilio);
    setNumero(editing.numero);
    setDraftLocation(editing.originalLatitud != null && editing.originalLongitud != null ? { latitude: editing.originalLatitud, longitude: editing.originalLongitud } : null);
  }

  return <section id="mapa" className="section-block">
    <div className="section-heading">
      <div><span className="section-kicker">Vista territorial</span><h2>Mapa de cartelería urbana</h2><p>Corregí direcciones y asigná ubicaciones directamente sobre el mapa.</p></div>
      <span className="inline-flex items-center gap-2 rounded-xl bg-municipal-50 px-4 py-2 text-xs font-bold text-municipal-700"><Layers3 size={15}/> {mapped} visibles · {carteles.length - mapped} pendientes</span>
    </div>
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div><b className="block text-xs text-ink">Nivel de contaminación visual</b><span className="text-[10px] text-slate-400">Filtra simultáneamente el mapa y las cards.</span></div>
      <div className="flex flex-wrap gap-1.5">{(["todos", "bajo", "medio", "alto", "critico"] as const).map(level => <button key={level} onClick={() => onContaminationFilter(level)} className={`rounded-lg px-3 py-2 text-[10px] font-extrabold capitalize transition ${contaminationFilter === level ? "bg-municipal-700 text-white shadow-sm" : "bg-slate-50 text-slate-500 hover:bg-municipal-50 hover:text-municipal-700"}`}>{level === "todos" ? "Todos" : level === "critico" ? "Crítico" : level}</button>)}</div>
    </div>
    <div className="relative h-[620px] overflow-hidden rounded-[26px] border border-slate-200 bg-slate-100 shadow-card">
      <CarteleriaMap carteles={carteles} selected={selected} onSelect={setSelected} editing={Boolean(editing)} draftLocation={draftLocation} onLocationPick={(latitude, longitude) => setDraftLocation({ latitude, longitude })}/>
      <div className="absolute bottom-5 left-5 z-[500] flex max-w-[calc(100%-90px)] flex-wrap gap-x-3 gap-y-2 rounded-xl border border-white/80 bg-white/95 p-3 shadow-lg backdrop-blur">{legend.map(([status, label]) => <span key={status} className="flex items-center gap-2 text-[9px] font-bold text-slate-600"><i className="size-2.5 rounded-full" style={{ background: situationColors[status] }}/>{label}</span>)}</div>
      <div className="absolute left-5 top-5 z-[500] rounded-xl bg-white/95 px-4 py-2 text-[10px] font-semibold text-slate-500 shadow-lg">{mapped} puntos verificados</div>

      {editing ? <aside className="absolute right-5 top-5 z-[600] w-[min(380px,calc(100%-40px))] rounded-2xl border border-municipal-100 bg-white/95 p-5 shadow-2xl backdrop-blur">
        <button onClick={() => onEditingChange(null)} className="absolute right-3 top-3 grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Cancelar corrección"><X size={17}/></button>
        <span className="section-kicker">Corrección de ubicación</span>
        <h3 className="mt-2 pr-7 font-display text-base font-extrabold text-ink">{editing.tipoCartel} · {editing.empresa || "Sin empresa"}</h3>
        <div className="mt-4 grid gap-3">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Domicilio<input value={domicilio} onChange={event => setDomicilio(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs font-medium normal-case tracking-normal text-ink outline-none focus:border-municipal-500"/></label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Número / referencia<input value={numero} onChange={event => setNumero(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs font-medium normal-case tracking-normal text-ink outline-none focus:border-municipal-500"/></label>
        </div>
        {editing.googleMapsUrl?.startsWith("http") && <a href={editing.googleMapsUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-bold text-municipal-700">Comparar con Google Maps <ExternalLink size={12}/></a>}
        <div className={`mt-4 flex gap-3 rounded-xl p-3 ${draftLocation ? "bg-municipal-50 text-municipal-900" : "bg-amber-50 text-amber-800"}`}><Crosshair className="shrink-0" size={18}/><div><b className="block text-xs">{draftLocation ? "Punto seleccionado" : "Hacé clic en el mapa"}</b><span className="mt-1 block text-[10px] leading-4">{draftLocation ? `${draftLocation.latitude.toFixed(6)}, ${draftLocation.longitude.toFixed(6)}` : "Elegí la ubicación exacta del cartel antes de guardar."}</span></div></div>
        <button onClick={saveCorrection} disabled={!draftLocation} className="primary-button mt-4 w-full justify-center disabled:cursor-not-allowed disabled:opacity-40"><Check size={16}/> Guardar corrección</button>
        <button onClick={restoreOriginalDraft} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-600"><RotateCcw size={14}/> Restaurar ubicación original</button>
      </aside> : selected && <aside className="absolute right-5 top-5 z-[600] w-[min(370px,calc(100%-40px))] rounded-2xl border border-white bg-white/95 p-5 shadow-2xl backdrop-blur">
        <button onClick={() => setSelected(null)} className="absolute right-3 top-3 grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Cerrar detalle"><X size={17}/></button>
        <div className="flex flex-wrap gap-2"><span className="section-kicker">{situationLabels[selected.status]}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold uppercase text-slate-500">Contaminación {selected.contaminationLevel}</span>{selected.locationEdited && <span className="rounded-full bg-municipal-50 px-2 py-1 text-[9px] font-bold uppercase text-municipal-700">Ubicación corregida</span>}</div>
        <h3 className="mt-2 pr-7 font-display text-base font-extrabold text-ink">{selected.tipoCartel} · {selected.empresa || "Sin empresa"}</h3>
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-500"><MapPin size={14} className="mt-0.5 shrink-0 text-municipal-700"/>{cartelAddress(selected)}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => onEditingChange(selected.id)} className="secondary-button compact"><Crosshair size={14}/> Corregir ubicación</button>
          {selected.googleMapsUrl?.startsWith("http") && <a href={selected.googleMapsUrl} target="_blank" rel="noreferrer" className="primary-button compact"><ExternalLink size={14}/> Ver en Google Maps</a>}
          {selected.locationEdited && <button onClick={() => resetLocation(selected)} className="secondary-button compact text-rose-600 hover:text-rose-700"><RotateCcw size={14}/> Eliminar corrección</button>}
        </div>
      </aside>}
    </div>
  </section>;
}
