import { ArrowRight, FileSearch, MapPin } from "lucide-react";

export function Hero() {
  return (
    <section id="inicio" className="relative flex min-h-[100svh] items-start overflow-hidden border-b border-black/5 bg-transparent pb-10 pt-5 sm:pb-14 sm:pt-7 lg:pb-16 lg:pt-9">
      <div className="hero-grid absolute inset-0 opacity-40" />
      <div className="absolute -right-32 top-0 size-[520px] rounded-full bg-[#2DB0FF]/10 blur-3xl" />
      <div className="absolute -left-36 bottom-0 size-80 rounded-full bg-[#0166FF]/5 blur-3xl" />

      <div className="page-shell relative grid w-full items-center gap-8 sm:gap-10 lg:grid-cols-[minmax(0,1.08fr)_minmax(420px,.92fr)] lg:gap-8 xl:grid-cols-[minmax(0,1.12fr)_minmax(460px,.88fr)]">
        <div className="relative max-w-[720px] py-3 sm:py-5">
          <span className="eyebrow">
            <span className="size-2 rounded-full bg-brandYellow shadow-[0_0_0_4px_rgba(244,220,0,.14)]" />
            Municipalidad de San Miguel de Tucumán
          </span>

          <h1 className="mt-6 font-display tracking-[-.05em] sm:mt-7">
            <span className="block text-[2.7rem] font-extrabold leading-[.98] text-ink sm:text-[3.45rem] lg:whitespace-nowrap lg:text-[3.8rem]">Visualizador de</span>
            <span className="mt-2 block max-w-[690px] text-[3.25rem] font-black leading-[.92] text-[#0166FF] sm:text-[4.2rem] lg:text-[4.6rem]">Cartelería Urbana</span>
          </h1>

          <p className="mt-6 max-w-[650px] text-base leading-7 text-slate-600 sm:mt-7 sm:text-[1.08rem] sm:leading-8">
            Consulta dinámica de documentos, relevamientos, corredores permitidos y normativa vinculada a la cartelería publicitaria de San Miguel de Tucumán.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:flex-wrap">
            <a href="#mapa" className="primary-button justify-center sm:justify-start">
              <MapPin size={17} /> Ver mapa <ArrowRight size={15} />
            </a>
            <a href="#documentos" className="secondary-button justify-center sm:justify-start">
              <FileSearch size={17} /> Explorar documentos
            </a>
          </div>

          <div className="mt-7 flex flex-wrap gap-2 border-t border-slate-200/80 pt-5 sm:mt-9">
            <span className="rounded-full border border-white/80 bg-white/70 px-3 py-1.5 text-[9px] font-extrabold uppercase tracking-[.11em] text-slate-500 shadow-sm backdrop-blur">Diagnóstico territorial</span>
            <span className="rounded-full border border-white/80 bg-white/70 px-3 py-1.5 text-[9px] font-extrabold uppercase tracking-[.11em] text-slate-500 shadow-sm backdrop-blur">Control administrativo</span>
            <span className="rounded-full border border-white/80 bg-white/70 px-3 py-1.5 text-[9px] font-extrabold uppercase tracking-[.11em] text-slate-500 shadow-sm backdrop-blur">Normativa municipal</span>
          </div>
        </div>

      </div>
    </section>
  );
}
