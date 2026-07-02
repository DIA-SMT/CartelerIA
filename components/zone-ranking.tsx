import { BarChart3, MapPinned } from "lucide-react";
import type { CartelRecord, ContaminationLevel } from "@/data/carteles";

const zones: { name: string; level: ContaminationLevel; progress: number }[] = [
  { name: "Microcentro", level: "critico", progress: 94 },
  { name: "Av. Mate de Luna", level: "alto", progress: 82 },
  { name: "Av. Belgrano", level: "alto", progress: 74 },
  { name: "Av. Alem", level: "medio", progress: 59 },
  { name: "Av. Roca", level: "bajo", progress: 36 }
];

const levelStyle: Record<ContaminationLevel, { label: string; bar: string; badge: string }> = {
  bajo: { label: "Bajo", bar: "bg-municipal-500", badge: "bg-sky-50 text-municipal-700" },
  medio: { label: "Medio", bar: "bg-brandYellow", badge: "bg-amber-50 text-amber-700" },
  alto: { label: "Alto", bar: "bg-orange-500", badge: "bg-orange-50 text-orange-700" },
  critico: { label: "Crítico", bar: "bg-red-600", badge: "bg-red-50 text-red-700" }
};

export function ZoneRanking({ carteles }: { carteles: CartelRecord[] }) {
  return <section className="page-shell mt-5"><div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-card md:p-6"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-municipal-50 text-municipal-700"><BarChart3 size={20}/></span><div><span className="section-kicker">Lectura territorial</span><h3 className="font-display text-lg font-extrabold text-ink">Zonas con mayor concentración</h3></div></div><span className="text-[10px] font-semibold text-slate-400">Indicadores visuales de referencia</span></div><div className="mt-5 grid gap-3 md:grid-cols-5">{zones.map(zone => { const count = carteles.filter(item => item.zone === zone.name).length; const style = levelStyle[zone.level]; return <article key={zone.name} className="rounded-xl border border-slate-100 bg-slate-50/60 p-4"><div className="flex items-start justify-between gap-2"><MapPinned size={16} className="mt-0.5 shrink-0 text-municipal-700"/><span className={`rounded-full px-2 py-1 text-[8px] font-extrabold uppercase ${style.badge}`}>{style.label}</span></div><h4 className="mt-3 text-xs font-extrabold text-ink">{zone.name}</h4><span className="mt-1 block text-[10px] text-slate-400">{count} carteles identificados</span><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className={`h-full rounded-full ${style.bar}`} style={{ width: `${zone.progress}%` }}/></div></article>; })}</div></div></section>;
}
