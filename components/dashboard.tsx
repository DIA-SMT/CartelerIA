"use client";

import { useEffect, useState } from "react";
import type { UrbanDocument } from "@/data/documents";
import type { AnalyzedCartel, FeatureCollection, GeoLine, GeoPoint, TerritorialFilterState } from "@/data/territorial";
import { filterTerritorialCarteles, initialTerritorialFilters, loadTerritorialLayers } from "@/data/territorial";
import { CartelLibrary } from "./cartel-library";
import { CorridorsSection } from "./corridors-section";
import { Header } from "./header";
import { Hero } from "./hero";
import { MapPreview } from "./map-preview";
import { PdfLibrary } from "./pdf-library";
import { PdfViewer } from "./pdf-viewer";
import { StatsCards } from "./stats-cards";

const emptyLines: FeatureCollection<GeoLine> = { type: "FeatureCollection", features: [] };
const emptyPoints: FeatureCollection<GeoPoint> = { type: "FeatureCollection", features: [] };

export function Dashboard() {
  const [selectedDocument, setSelectedDocument] = useState<UrbanDocument | null>(null);
  const [analyzedCarteles, setAnalyzedCarteles] = useState<AnalyzedCartel[]>([]);
  const [corridors, setCorridors] = useState<FeatureCollection<GeoLine>>(emptyLines);
  const [allowedPlaces, setAllowedPlaces] = useState<FeatureCollection<GeoPoint>>(emptyPoints);
  const [filters, setFilters] = useState<TerritorialFilterState>(initialTerritorialFilters);
  const filteredAnalyzed = filterTerritorialCarteles(analyzedCarteles, filters);

  useEffect(() => {
    let active = true;
    loadTerritorialLayers().then(layers => {
      if (!active) return;
      setCorridors(layers.corridors);
      setAllowedPlaces(layers.allowedPlaces);
      setAnalyzedCarteles(layers.analyzed.features);
    }).catch(error => console.error("Error al cargar GeoJSON", error));
    return () => { active = false; };
  }, []);

  return <>
    <Header/>
    <main>
      <Hero/>
      <StatsCards cartelesCount={analyzedCarteles.length}/>
      <MapPreview carteles={filteredAnalyzed} allCarteles={analyzedCarteles} corridors={corridors} allowedPlaces={allowedPlaces} filters={filters} onFilters={setFilters}/>
      <CartelLibrary carteles={filteredAnalyzed}/>
      <PdfLibrary onOpen={setSelectedDocument}/>
      <CorridorsSection/>
    </main>
    <footer className="mt-20 border-t border-slate-200 bg-white"><div className="page-shell flex flex-col justify-between gap-4 py-8 sm:flex-row sm:items-center"><div className="text-xs text-slate-400"><b className="block text-ink">Cartelería Urbana SMT</b>Municipalidad de San Miguel de Tucumán</div><span className="text-xs text-slate-400">Capas territoriales estáticas · GeoJSON</span></div></footer>
    <PdfViewer document={selectedDocument} onClose={() => setSelectedDocument(null)}/>
  </>;
}
