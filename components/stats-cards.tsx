import { BookOpenText, MapPinned, Route, Signpost } from "lucide-react";

const stats = [
  { label: "Documentos cargados", value: "15", icon: BookOpenText, style: "bg-municipal-50 text-municipal-700" },
  { label: "Carteles identificados", value: "201", icon: Signpost, style: "bg-sky-50 text-sky-600" },
  { label: "Corredores publicitarios", value: "13", icon: Route, style: "bg-amber-50 text-amber-600" },
  { label: "Categorías normativas", value: "5", icon: MapPinned, style: "bg-blue-50 text-blue-700" }
];

export function StatsCards({ cartelesCount }: { cartelesCount: number }) {
  const currentStats = stats.map(item => item.label === "Carteles identificados" ? { ...item, value: String(cartelesCount) } : item);
  return <section className="page-shell relative z-10 -mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{currentStats.map(({ label, value, icon: Icon, style }) => <article className="stat-card" key={label}><span className={`grid size-11 place-items-center rounded-xl ${style}`}><Icon size={20}/></span><div><strong className="block font-display text-2xl font-extrabold tracking-tight text-ink">{value}</strong><span className="text-xs font-semibold text-slate-400">{label}</span></div></article>)}</section>;
}
