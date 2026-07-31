"use client";

import Image from "next/image";
import { HelpCircle, Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { APPROVALS_COUNT_EVENT } from "@/data/approvals";
import { TOUR_EVENT } from "@/data/tour";
import { useAuth } from "@/hooks/use-auth";
import { HeaderSession } from "./header-session";

type NavItem = { href: string; label: string; badge?: number };

const baseNavigation: NavItem[] = [
  { href: "#inicio", label: "Inicio" },
  { href: "#mapa", label: "Mapa" },
  { href: "#carteles", label: "Carteles" },
  { href: "#documentos", label: "Documentos" },
  { href: "#corredores", label: "Corredores" },
];

export function Header() {
  const auth = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Contador de aprobaciones pendientes: lo publica la bandeja al refrescar.
  useEffect(() => {
    const onCount = (event: Event) => setPendingApprovals((event as CustomEvent<number>).detail);
    window.addEventListener(APPROVALS_COUNT_EVENT, onCount);
    return () => window.removeEventListener(APPROVALS_COUNT_EVENT, onCount);
  }, []);

  // Las secciones de gestión entran a la nav según el rol de la sesión.
  const navigation: NavItem[] = [
    ...baseNavigation,
    ...(auth.canRead ? [{ href: "#expedientes", label: "Expedientes" }] : []),
    ...(auth.canRead && auth.role === "administrador"
      ? [{ href: "#aprobaciones", label: "Aprobaciones", badge: pendingApprovals }]
      : []),
  ];

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

        <nav aria-label="Navegación principal" className="hidden items-center gap-7 text-sm font-semibold text-slate-500 lg:flex">
          {navigation.map((item, index) => <a key={item.href} className={`inline-flex items-center ${index === 0 ? "text-municipal-700" : "transition hover:text-municipal-700"}`} href={item.href}>{item.label}<NavBadge count={item.badge}/></a>)}
        </nav>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <button onClick={startTour} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/85 px-2.5 py-2 text-[11px] font-bold text-slate-600 transition hover:border-municipal-300 hover:text-municipal-700" aria-label="¿Cómo funciona? Ver recorrido guiado"><HelpCircle size={15} /><span className="hidden lg:inline">¿Cómo funciona?</span></button>
          <HeaderSession />
          <button ref={toggleRef} onClick={() => setMenuOpen(value => !value)} className="icon-button grid lg:hidden" aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"} aria-expanded={menuOpen} aria-controls="mobile-navigation">{menuOpen ? <X size={21}/> : <Menu size={21}/>}</button>
        </div>
      </div>

      {menuOpen && <div className="fixed inset-x-0 top-[72px] h-[calc(100dvh-72px)] lg:hidden">
        <button className="absolute inset-0 cursor-default bg-slate-950/20 backdrop-blur-[2px]" onClick={closeMenu} aria-label="Cerrar menú al tocar fuera"/>
        <div ref={menuRef} id="mobile-navigation" role="dialog" aria-modal="true" aria-label="Menú de navegación" className="absolute inset-x-3 top-3 overflow-hidden rounded-2xl border border-white/80 bg-white/95 p-3 shadow-2xl backdrop-blur-xl sm:left-auto sm:right-5 sm:w-80">
          <nav className="grid gap-1" aria-label="Navegación mobile">
            {navigation.map((item, index) => <a key={item.href} href={item.href} onClick={closeMenu} className={`flex items-center rounded-xl px-4 py-3 text-sm font-bold transition ${index === 0 ? "bg-municipal-50 text-municipal-700" : "text-slate-600 hover:bg-slate-50 hover:text-municipal-700"}`}>{item.label}<NavBadge count={item.badge}/></a>)}
          </nav>
        </div>
      </div>}
    </header>
  );
}

/** Contador de pendientes junto al item de nav (oculto en cero). */
function NavBadge({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span aria-label={`${count} pendientes`} className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-micro font-extrabold leading-none text-amber-800">
      {count > 99 ? "99+" : count}
    </span>
  );
}
