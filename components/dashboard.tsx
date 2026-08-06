"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import type { UrbanDocument } from "@/data/documents";
import { documents } from "@/data/documents";
import type { AnalyzedCartel } from "@/data/territorial";
import { useTerritorialMap } from "@/hooks/use-territorial-map";
import { CartelLibrary } from "./cartel-library";
import { CorridorsSection } from "./corridors-section";
import { Header } from "./header";
import { Hero } from "./hero";
import { ExpedientesRegistro } from "./expedientes-registro";
import { IndicadoresGestion } from "./indicadores-gestion";
import { MapPreview } from "./map-preview";
import { NormativaAsk } from "./normativa-ask";
import { PdfLibrary } from "./pdf-library";
import { PdfViewer } from "./pdf-viewer";
import { ProductTour } from "./product-tour";
import { StatsCards } from "./stats-cards";
import { Toaster } from "./toaster";
import { TryhardHeroMap } from "./TryhardHeroMap";
import { ApprovalInbox } from "./approval-inbox";

/**
 * Configuración es la sección más pesada de la aplicación —cinco pestañas con
 * sus tablas— y la ve una sola persona. Se carga aparte para que no entre en el
 * bundle inicial de quien solo mira el mapa.
 */
const Configuracion = dynamic(() => import("./configuracion"), { ssr: false });

export function Dashboard() {
  const [viewer, setViewer] = useState<{ document: UrbanDocument; page: number | null } | null>(null);
  /** Solo persiste la identidad: los datos se derivan siempre de la colección vigente. */
  const [selectedCartelId, setSelectedCartelId] = useState<string | null>(null);
  const territorial = useTerritorialMap();
  const selectedCartel = selectedCartelId === null
    ? null
    : territorial.carteles.find((cartel) => String(cartel.properties.id) === selectedCartelId) ?? null;
  const selectCartel = useCallback((cartel: AnalyzedCartel | null) => {
    setSelectedCartelId(cartel === null ? null : String(cartel.properties.id));
  }, []);

  const openDocument = (document: UrbanDocument, page: number | null = null) => setViewer({ document, page });
  const openDocumentById = (documentoId: string, page: number | null) => {
    const document = documents.find((item) => item.id === documentoId);
    if (document) openDocument(document, page);
  };

  /** Localiza un cartel en el mapa de la página: lo selecciona (vuelo + ficha) y scrollea hasta él. */
  const locateCartel = (cartel: AnalyzedCartel) => {
    selectCartel(cartel);
    document.querySelector('[data-tour="map-canvas"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return <>
    <Header/>
    <main className="relative z-[1]">
      <div data-territorial-background-zone className="relative isolate overflow-hidden">
        <TryhardHeroMap/>
        <div className="relative z-[1]">
          <Hero/>
          <StatsCards cartelesCount={territorial.carteles.length} corridorsCount={territorial.corridors.features.length} loading={territorial.loading}/>
          <MapPreview carteles={territorial.filteredCarteles} allCarteles={territorial.carteles} corridors={territorial.corridors} allowedPlaces={territorial.allowedPlaces} filters={territorial.filters} onFilters={territorial.setFilters} loading={territorial.loading} error={territorial.error} onRetry={territorial.retry} administrativeSource={territorial.administrativeSource} linkedCount={territorial.linkedCount} selected={selectedCartel} onSelect={selectCartel}/>
        </div>
      </div>
      {/* Bloque de gestión contiguo: indicadores, bandeja de aprobaciones,
          registro de expedientes y administración del sistema. Todos se ocultan
          sin la sesión/rol correspondiente. */}
      <IndicadoresGestion/>
      <ApprovalInbox/>
      <ExpedientesRegistro/>
      <Configuracion/>
      <CartelLibrary carteles={territorial.filteredCarteles} onLocate={locateCartel}/>
      <div id="normativa" data-tour="normativa" className="section-block pb-0"><NormativaAsk onOpenDocument={openDocumentById}/></div>
      <PdfLibrary onOpen={(document) => openDocument(document)}/>
      <CorridorsSection/>
    </main>
    <footer className="relative z-[1] mt-20 border-t border-slate-200 bg-white/90 backdrop-blur-sm"><div className="page-shell flex flex-col justify-between gap-4 py-8 sm:flex-row sm:items-center"><div className="text-xs text-slate-400"><b className="block text-ink">Cartelería Urbana SMT</b>Municipalidad de San Miguel de Tucumán</div><span className="text-xs text-slate-400">Capas territoriales estáticas · GeoJSON</span></div></footer>
    {viewer && <PdfViewer document={viewer.document} page={viewer.page} onClose={() => setViewer(null)}/>}
    <ProductTour/>
    <Toaster/>
  </>;
}
