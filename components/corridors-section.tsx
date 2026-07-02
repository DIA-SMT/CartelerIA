import { Activity, ArrowDownUp, ArrowLeftRight, DoorOpen, Map } from "lucide-react";

const corridors = [
  { title: "Corredores Oeste–Este", description: "Ejes de circulación que conectan accesos occidentales con el centro y el este urbano.", icon: ArrowLeftRight, tag: "4 ejes" },
  { title: "Corredores Norte–Sur", description: "Avenidas estructurantes con concentración sostenida de soportes publicitarios.", icon: ArrowDownUp, tag: "3 ejes" },
  { title: "Microcentro", description: "Área de regulación prioritaria por densidad peatonal, patrimonial y comercial.", icon: Map, tag: "Zona especial" },
  { title: "Puntos de acceso", description: "Entradas estratégicas a la ciudad y sectores de primera percepción visual.", icon: DoorOpen, tag: "6 accesos" },
  { title: "Contaminación visual", description: "Escala comparativa para reconocer saturación baja, media y alta del paisaje.", icon: Activity, tag: "3 niveles" }
];

export function CorridorsSection() {
  return <section id="corredores" className="section-block"><div className="section-heading"><div><span className="section-kicker">Lectura urbana</span><h2>Corredores publicitarios</h2><p>Clasificación visual de los principales ejes y áreas de interés.</p></div></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">{corridors.map(({ title, description, icon: Icon, tag }, index) => <article key={title} className={`rounded-2xl border p-5 ${index === 4 ? "border-brandYellow/60 bg-amber-50/50" : "border-slate-200 bg-white"}`}><span className={`grid size-11 place-items-center rounded-xl ${index === 4 ? "bg-brandYellow text-ink" : "bg-municipal-50 text-municipal-700"}`}><Icon size={20}/></span><h3 className="mt-5 font-display text-sm font-extrabold leading-5 text-ink">{title}</h3><p className="mt-2 text-xs leading-5 text-slate-500">{description}</p><span className="mt-5 inline-block rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-slate-500 shadow-sm">{tag}</span></article>)}</div></section>;
}
