import { BookOpenText, MapPinned, Route, Signpost } from "lucide-react";
import { documents } from "@/data/documents";

// Derivadas del catálogo real, no hardcodeadas.
const documentosCount = documents.length;
const categoriasCount = new Set(documents.map((document) => document.category)).size;

type Props = {
  cartelesCount: number;
  corridorsCount: number;
  /** Mientras cargan las capas territoriales se muestra un guión, no un 0 falso. */
  loading?: boolean;
};

export function StatsCards({ cartelesCount, corridorsCount, loading = false }: Props) {
  const territorial = (value: number) => (loading ? "—" : String(value));
  const stats = [
    { label: "Documentos cargados", value: String(documentosCount), icon: BookOpenText, style: "bg-municipal-50 text-municipal-700" },
    { label: "Carteles identificados", value: territorial(cartelesCount), icon: Signpost, style: "bg-sky-50 text-sky-600" },
    { label: "Corredores publicitarios", value: territorial(corridorsCount), icon: Route, style: "bg-amber-50 text-amber-600" },
    { label: "Categorías normativas", value: String(categoriasCount), icon: MapPinned, style: "bg-blue-50 text-blue-700" }
  ];
  return <section className="page-shell relative z-10 -mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{stats.map(({ label, value, icon: Icon, style }) => <article className="stat-card" key={label}><span className={`grid size-11 place-items-center rounded-xl ${style}`}><Icon size={20}/></span><div><strong className="block font-display text-2xl font-extrabold tracking-tight text-ink">{value}</strong><span className="text-xs font-semibold text-slate-400">{label}</span></div></article>)}</section>;
}
