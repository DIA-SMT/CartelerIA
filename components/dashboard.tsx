"use client";

import { useState } from "react";
import type { UrbanDocument } from "@/data/documents";
import { documents } from "@/data/documents";
import { useTerritorialMap } from "@/hooks/use-territorial-map";
import { CartelLibrary } from "./cartel-library";
import { CorridorsSection } from "./corridors-section";
import { Header } from "./header";
import { Hero } from "./hero";
import { ExpedientesRegistro } from "./expedientes-registro";
import { MapPreview } from "./map-preview";
import { NormativaAsk } from "./normativa-ask";
import { PdfLibrary } from "./pdf-library";
import { PdfViewer } from "./pdf-viewer";
import { ProductTour } from "./product-tour";
import { StatsCards } from "./stats-cards";
import { TryhardHeroMap } from "./TryhardHeroMap";

export function Dashboard() {
  const [viewer, setViewer] = useState<{ document: UrbanDocument; page: number | null } | null>(null);
  const territorial = useTerritorialMap();

  const openDocument = (document: UrbanDocument, page: number | null = null) => setViewer({ document, page });
  const openDocumentById = (documentoId: string, page: number | null) => {
    const document = documents.find((item) => item.id === documentoId);
    if (document) openDocument(document, page);
  };

  return <>
    <Header/>
    <main className="relative z-[1]">
      <div data-territorial-background-zone className="relative isolate overflow-hidden">
        <TryhardHeroMap/>
        <div className="relative z-[1]">
          <Hero/>
          <StatsCards cartelesCount={territorial.carteles.length}/>
          <MapPreview carteles={territorial.filteredCarteles} allCarteles={territorial.carteles} corridors={territorial.corridors} allowedPlaces={territorial.allowedPlaces} filters={territorial.filters} onFilters={territorial.setFilters} loading={territorial.loading} error={territorial.error} onRetry={territorial.retry} administrativeSource={territorial.administrativeSource} linkedCount={territorial.linkedCount}/>
        </div>
      </div>
      <CartelLibrary carteles={territorial.filteredCarteles}/>
      <div data-tour="normativa" className="section-block pb-0"><NormativaAsk onOpenDocument={openDocumentById}/></div>
      <PdfLibrary onOpen={(document) => openDocument(document)}/>
      <ExpedientesRegistro/>
      <CorridorsSection/>
    </main>
    <footer className="relative z-[1] mt-20 border-t border-slate-200 bg-white/90 backdrop-blur-sm"><div className="page-shell flex flex-col justify-between gap-4 py-8 sm:flex-row sm:items-center"><div className="text-xs text-slate-400"><b className="block text-ink">Cartelería Urbana SMT</b>Municipalidad de San Miguel de Tucumán</div><span className="text-xs text-slate-400">Capas territoriales estáticas · GeoJSON</span></div></footer>
    <PdfViewer document={viewer?.document ?? null} page={viewer?.page ?? null} onClose={() => setViewer(null)}/>
    <ProductTour/>
  </>;
}
