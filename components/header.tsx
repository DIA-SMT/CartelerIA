"use client";

import Image from "next/image";
import { HelpCircle } from "lucide-react";
import { TOUR_EVENT } from "@/data/tour";
import { AppSidebar } from "./app-sidebar";
import { HeaderSession } from "./header-session";

/**
 * Barra superior: identidad, recorrido guiado y sesión.
 *
 * La navegación entera vive en `AppSidebar`, que también es dueño de la lógica
 * de rol y del contador de aprobaciones. Este componente ya no calcula items ni
 * mantiene su propia trampa de foco: eso lo resuelve `use-modal-shell` dentro
 * del cajón.
 *
 * La altura de 72px es un contrato con `.section-block { scroll-mt-24 }`: si
 * cambia, hay que ajustar el `scroll-mt` en la misma pasada o los anclajes
 * quedan tapados.
 */
export function Header() {
  const startTour = () => window.dispatchEvent(new Event(TOUR_EVENT));

  return (
    <header className="sticky top-0 z-[1000] border-b border-black/5 bg-white/90 backdrop-blur-xl">
      <div className="page-shell flex h-[72px] items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <AppSidebar/>
          <a href="#inicio" className="flex min-w-0 items-center gap-3" aria-label="Inicio Cartelería SMT">
            <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-100">
              <Image src="/logo-municipalidad-smt.png" alt="Municipalidad de San Miguel de Tucumán" width={42} height={42} priority/>
            </span>
            <span className="min-w-0">
              <strong className="block truncate font-display text-[15px] tracking-tight text-ink">Cartelería Urbana SMT</strong>
              <small className="hidden text-micro font-semibold uppercase tracking-[.16em] text-slate-400 sm:block">Visualizador documental</small>
            </span>
          </a>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <button
            onClick={startTour}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/85 px-2.5 py-2 text-tiny font-bold text-slate-600 transition duration-fast hover:border-municipal-300 hover:text-municipal-700"
            aria-label="¿Cómo funciona? Ver recorrido guiado"
          >
            <HelpCircle size={15}/>
            <span className="hidden lg:inline">¿Cómo funciona?</span>
          </button>
          <HeaderSession/>
        </div>
      </div>
    </header>
  );
}
