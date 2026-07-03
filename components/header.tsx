"use client";

import Image from "next/image";
import { Bell, Menu, Search } from "lucide-react";

export function Header() {
  return (
    <header className="sticky top-0 z-[1000] border-b border-black/5 bg-white/90 backdrop-blur-xl">
      <div className="page-shell flex h-[72px] items-center justify-between gap-6">
        <a href="#inicio" className="flex items-center gap-3" aria-label="Inicio Cartelería SMT">
          <span className="grid size-11 place-items-center overflow-hidden rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-100"><Image src="/logo-municipalidad-smt.png" alt="Municipalidad de San Miguel de Tucumán" width={42} height={42} priority /></span>
          <span><strong className="block font-display text-[15px] tracking-tight text-ink">Cartelería Urbana SMT</strong><small className="block text-[10px] font-semibold uppercase tracking-[.16em] text-slate-400">Visualizador documental</small></span>
        </a>
        <nav className="hidden items-center gap-8 text-sm font-semibold text-slate-500 lg:flex">
          <a className="text-municipal-700" href="#inicio">Inicio</a><a href="#mapa">Mapa</a><a href="#carteles">Carteles</a><a href="#documentos">Documentos</a><a href="#corredores">Corredores</a>
        </nav>
        <div className="flex items-center gap-2">
          <button className="icon-button hidden sm:grid" aria-label="Buscar"><Search size={18} /></button>
          <button className="icon-button hidden sm:grid" aria-label="Notificaciones"><Bell size={18} /></button>
          <button className="icon-button lg:hidden" aria-label="Abrir menú"><Menu size={20} /></button>
        </div>
      </div>
    </header>
  );
}
