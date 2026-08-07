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

/**
 * Franja de contexto entre el hero y el mapa.
 *
 * Es deliberadamente compacta: son datos de encuadre —cuánto hay— y compiten
 * con el mapa, que es lo que la gente vino a ver. Las métricas de gestión, que
 * son otra cosa y exigen sesión, viven en la sección Indicadores.
 */
export function StatsCards({ cartelesCount, corridorsCount, loading = false }: Props) {
  const territorial = (value: number) => (loading ? "—" : new Intl.NumberFormat("es-AR").format(value));
  const stats = [
    { label: "Carteles identificados", value: territorial(cartelesCount), icon: Signpost },
    { label: "Corredores publicitarios", value: territorial(corridorsCount), icon: Route },
    { label: "Documentos cargados", value: String(documentosCount), icon: BookOpenText },
    { label: "Categorías normativas", value: String(categoriasCount), icon: MapPinned },
  ];

  return (
    <section className="page-shell relative z-10 -mt-4">
      <dl className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm backdrop-blur-sm sm:gap-x-8 sm:px-5">
        {stats.map(({ label, value, icon: Icon }, index) => (
          <div
            key={label}
            className={`flex items-center gap-2.5 ${
              index > 0 ? "sm:border-l sm:border-slate-200 sm:pl-6 lg:pl-8" : ""
            }`}
          >
            <Icon size={16} className="shrink-0 text-municipal-600"/>
            <div className="min-w-0">
              <dd className="font-display text-lg font-extrabold leading-none tracking-tight text-ink">
                {value}
              </dd>
              <dt className="mt-0.5 truncate text-micro font-semibold text-slate-400">{label}</dt>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}
