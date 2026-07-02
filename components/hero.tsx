import { ArrowRight, FileSearch, MapPin } from "lucide-react";

export function Hero() {
  return (
    <section id="inicio" className="relative overflow-hidden border-b border-black/5 bg-[#f5f7f3] py-14 md:py-20">
      <div className="hero-grid absolute inset-0 opacity-50" />
      <div className="page-shell relative grid items-center gap-10 lg:grid-cols-[1fr_420px]">
        <div className="max-w-3xl">
          <span className="eyebrow"><span className="size-2 rounded-full bg-brandYellow shadow-sm" /> Municipalidad de San Miguel de Tucumán</span>
          <h1 className="mt-5 max-w-3xl font-display text-4xl font-extrabold leading-[1.08] tracking-[-.045em] text-ink md:text-6xl">Visualizador de <span className="text-municipal-700">Cartelería Urbana</span></h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-500 md:text-lg">Consulta dinámica de documentos, relevamientos y normativa vinculada a la cartelería publicitaria de la ciudad.</p>
          <div className="mt-8 flex flex-wrap gap-3"><a href="#documentos" className="primary-button"><FileSearch size={17} /> Explorar documentos</a><a className="secondary-button" href="#mapa"><MapPin size={17} /> Ver mapa</a></div>
        </div>
        <div className="relative hidden lg:block">
          <div className="absolute -inset-10 rounded-full bg-municipal-100/60 blur-3xl" />
          <div className="relative rotate-1 rounded-[28px] border border-white bg-white/80 p-5 shadow-card backdrop-blur">
            <div className="mini-map h-64 rounded-2xl p-5"><div className="flex justify-between"><span className="rounded-full bg-white px-3 py-1 text-[10px] font-bold text-slate-500 shadow"><i className="mr-2 inline-block size-1.5 rounded-full bg-brandYellow"/>SAN MIGUEL DE TUCUMÁN</span><span className="grid size-9 place-items-center rounded-xl bg-municipal-700 text-white"><FileSearch size={17}/></span></div><div className="mt-28 flex items-end justify-between"><div className="map-pin"><MapPin size={19}/></div><div className="rounded-xl bg-white p-3 shadow-lg"><span className="text-[10px] font-bold text-slate-400">COBERTURA</span><b className="mt-1 flex items-center gap-1 text-sm text-ink">Toda la ciudad <ArrowRight size={14}/></b></div></div></div>
          </div>
        </div>
      </div>
    </section>
  );
}
