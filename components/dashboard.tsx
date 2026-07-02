"use client";

import { useEffect, useState } from "react";
import type { UrbanDocument } from "@/data/documents";
import type { CartelRecord } from "@/data/carteles";
import type { ContaminationLevel } from "@/data/carteles";
import { initialCarteles } from "@/data/carteles";
import { CartelLibrary } from "./cartel-library";
import { CorridorsSection } from "./corridors-section";
import { Header } from "./header";
import { Hero } from "./hero";
import { MapPreview } from "./map-preview";
import { PdfLibrary } from "./pdf-library";
import { PdfViewer } from "./pdf-viewer";
import { StatsCards } from "./stats-cards";
import { ZoneRanking } from "./zone-ranking";

export function Dashboard() {
  const [selected, setSelected] = useState<UrbanDocument | null>(null);
  const [carteles, setCarteles] = useState<CartelRecord[]>(initialCarteles);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [contaminationFilter, setContaminationFilter] = useState<"todos" | ContaminationLevel>("todos");
  const filteredCarteles = contaminationFilter === "todos" ? carteles : carteles.filter(item => item.contaminationLevel === contaminationFilter);

  useEffect(() => {
    const saved = window.localStorage.getItem("carteleria-smt-corrections");
    if (!saved) return;
    try {
      const corrections = JSON.parse(saved) as Record<string, Partial<CartelRecord>>;
      setCarteles(current => current.map(item => corrections[item.id] ? { ...item, ...corrections[item.id], locationEdited: true } : item));
    } catch { window.localStorage.removeItem("carteleria-smt-corrections"); }
  }, []);

  function updateCartel(updated: CartelRecord) {
    setCarteles(current => current.map(item => item.id === updated.id ? updated : item));
    const saved = window.localStorage.getItem("carteleria-smt-corrections");
    let corrections: Record<string, Partial<CartelRecord>> = {};
    try { corrections = saved ? JSON.parse(saved) : {}; } catch { corrections = {}; }
    corrections[updated.id] = { domicilio: updated.domicilio, numero: updated.numero, latitud: updated.latitud, longitud: updated.longitud, locationEdited: true, locationSource: "manual" };
    window.localStorage.setItem("carteleria-smt-corrections", JSON.stringify(corrections));
  }

  function resetCartel(id: string) {
    const original = initialCarteles.find(item => item.id === id);
    if (!original) return;
    setCarteles(current => current.map(item => item.id === id ? original : item));
    const saved = window.localStorage.getItem("carteleria-smt-corrections");
    if (!saved) return;
    try {
      const corrections = JSON.parse(saved) as Record<string, Partial<CartelRecord>>;
      delete corrections[id];
      window.localStorage.setItem("carteleria-smt-corrections", JSON.stringify(corrections));
    } catch { window.localStorage.removeItem("carteleria-smt-corrections"); }
  }

  return <><Header/><main><Hero/><StatsCards cartelesCount={carteles.length}/><MapPreview carteles={filteredCarteles} allCarteles={carteles} editingId={editingId} onEditingChange={setEditingId} onUpdate={updateCartel} onReset={resetCartel} contaminationFilter={contaminationFilter} onContaminationFilter={setContaminationFilter}/><ZoneRanking carteles={carteles}/><CartelLibrary carteles={filteredCarteles} onCorrect={setEditingId}/><PdfLibrary onOpen={setSelected}/><CorridorsSection/></main><footer className="mt-20 border-t border-slate-200 bg-white"><div className="page-shell flex flex-col justify-between gap-4 py-8 sm:flex-row sm:items-center"><div className="text-xs text-slate-400"><b className="block text-ink">Cartelería Urbana SMT</b>Municipalidad de San Miguel de Tucumán</div><span className="text-xs text-slate-400">Visualizador documental · Datos estáticos</span></div></footer><PdfViewer document={selected} onClose={() => setSelected(null)}/></>;
}
