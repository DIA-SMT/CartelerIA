"use client";

import Image from "next/image";
import { Bell, HelpCircle, Menu, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TOUR_EVENT } from "@/data/tour";
import { HeaderSession } from "./header-session";

const navigation = [
  { href: "#inicio", label: "Inicio" },
  { href: "#mapa", label: "Mapa" },
  { href: "#carteles", label: "Carteles" },
  { href: "#documentos", label: "Documentos" },
  { href: "#corredores", label: "Corredores" },
];

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menuRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        toggleRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !menuRef.current) return;
      const focusable = Array.from(menuRef.current.querySelectorAll<HTMLElement>('a,button:not([disabled])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };

    const media = window.matchMedia("(min-width: 1024px)");
    const onBreakpointChange = (event: MediaQueryListEvent) => { if (event.matches) setMenuOpen(false); };
    document.addEventListener("keydown", onKeyDown);
    media.addEventListener("change", onBreakpointChange);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      media.removeEventListener("change", onBreakpointChange);
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);
  const startTour = () => { closeMenu(); window.dispatchEvent(new Event(TOUR_EVENT)); };

  return (
    <header className="sticky top-0 z-[1000] border-b border-black/5 bg-white/90 backdrop-blur-xl">
      <div className="page-shell flex h-[72px] items-center justify-between gap-4">
        <a href="#inicio" onClick={closeMenu} className="flex min-w-0 items-center gap-3" aria-label="Inicio Cartelería SMT">
          <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-100"><Image src="/logo-municipalidad-smt.png" alt="Municipalidad de San Miguel de Tucumán" width={42} height={42} priority /></span>
          <span className="min-w-0"><strong className="block truncate font-display text-[15px] tracking-tight text-ink">Cartelería Urbana SMT</strong><small className="hidden text-[10px] font-semibold uppercase tracking-[.16em] text-slate-400 sm:block">Visualizador documental</small></span>
        </a>

        <nav aria-label="Navegación principal" className="hidden items-center gap-8 text-sm font-semibold text-slate-500 lg:flex">
          {navigation.map((item, index) => <a key={item.href} className={index === 0 ? "text-municipal-700" : "transition hover:text-municipal-700"} href={item.href}>{item.label}</a>)}
        </nav>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <button onClick={startTour} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/85 px-2.5 py-2 text-[11px] font-bold text-slate-600 transition hover:border-municipal-300 hover:text-municipal-700" aria-label="¿Cómo funciona? Ver recorrido guiado"><HelpCircle size={15} /><span className="hidden lg:inline">¿Cómo funciona?</span></button>
          <HeaderSession />
          <button className="icon-button hidden sm:grid" aria-label="Buscar"><Search size={18} /></button>
          <button className="icon-button hidden sm:grid" aria-label="Notificaciones"><Bell size={18} /></button>
          <button ref={toggleRef} onClick={() => setMenuOpen(value => !value)} className="icon-button grid lg:hidden" aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"} aria-expanded={menuOpen} aria-controls="mobile-navigation">{menuOpen ? <X size={21}/> : <Menu size={21}/>}</button>
        </div>
      </div>

      {menuOpen && <div className="fixed inset-x-0 top-[72px] h-[calc(100dvh-72px)] lg:hidden">
        <button className="absolute inset-0 cursor-default bg-slate-950/20 backdrop-blur-[2px]" onClick={closeMenu} aria-label="Cerrar menú al tocar fuera"/>
        <div ref={menuRef} id="mobile-navigation" role="dialog" aria-modal="true" aria-label="Menú de navegación" className="absolute inset-x-3 top-3 overflow-hidden rounded-2xl border border-white/80 bg-white/95 p-3 shadow-2xl backdrop-blur-xl sm:left-auto sm:right-5 sm:w-80">
          <nav className="grid gap-1" aria-label="Navegación mobile">
            {navigation.map((item, index) => <a key={item.href} href={item.href} onClick={closeMenu} className={`rounded-xl px-4 py-3 text-sm font-bold transition ${index === 0 ? "bg-municipal-50 text-municipal-700" : "text-slate-600 hover:bg-slate-50 hover:text-municipal-700"}`}>{item.label}</a>)}
          </nav>
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3"><button onClick={closeMenu} className="secondary-button compact justify-center"><Search size={15}/>Buscar</button><button onClick={closeMenu} className="secondary-button compact justify-center"><Bell size={15}/>Avisos</button></div>
        </div>
      </div>}
    </header>
  );
}
