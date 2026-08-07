"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import type { UrbanDocument } from "@/data/documents";
import { documents } from "@/data/documents";
import { initialTerritorialFilters, type AnalyzedCartel } from "@/data/territorial";
import { useAuth } from "@/hooks/use-auth";
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

/**
 * La Fábrica Normativa también es una herramienta de pantalla completa: se
 * escribe una ordenanza artículo por artículo, no se la cruza scrolleando.
 */
const Fabrica = dynamic(() => import("./fabrica"), { ssr: false });

export function Dashboard() {
  const auth = useAuth();
  const [viewer, setViewer] = useState<{ document: UrbanDocument; page: number | null } | null>(null);
  /** Solo persiste la identidad: los datos se derivan siempre de la colección vigente. */
  const [selectedCartelId, setSelectedCartelId] = useState<string | null>(null);
  const [enConfiguracion, setEnConfiguracion] = useState(false);
  const [enFabrica, setEnFabrica] = useState(false);
  const territorial = useTerritorialMap();
  const selectedCartel = selectedCartelId === null
    ? null
    : territorial.carteles.find((cartel) => String(cartel.properties.id) === selectedCartelId) ?? null;
  const selectCartel = useCallback((cartel: AnalyzedCartel | null) => {
    setSelectedCartelId(cartel === null ? null : String(cartel.properties.id));
  }, []);

  // Configuración no vive en el scroll: es una herramienta de administración y
  // reemplaza el contenido de la página. Lo que la abre es el hash, así que un
  // enlace directo funciona igual que el ítem del menú.
  useEffect(() => {
    const sincronizar = () => {
      const hash = window.location.hash;
      setEnConfiguracion(hash.startsWith("#configuracion"));
      setEnFabrica(hash.startsWith("#fabrica"));
    };
    sincronizar();
    window.addEventListener("hashchange", sincronizar);
    return () => window.removeEventListener("hashchange", sincronizar);
  }, []);

  const isAdmin = auth.canRead && auth.role === "administrador";
  const mostrarConfiguracion = enConfiguracion && isAdmin;
  const mostrarFabrica = enFabrica && auth.canRead;
  const enHerramienta = mostrarConfiguracion || mostrarFabrica;

  // Entrar a una herramienta empieza arriba: se venía de cualquier punto del scroll.
  useEffect(() => {
    if (enHerramienta) window.scrollTo({ top: 0, behavior: "auto" });
  }, [enHerramienta]);

  const openDocument = (document: UrbanDocument, page: number | null = null) => setViewer({ document, page });
  const openDocumentById = (documentoId: string, page: number | null) => {
    const document = documents.find((item) => item.id === documentoId);
    if (document) openDocument(document, page);
  };

  /**
   * Pinta en el mapa el conjunto exacto que devolvió una simulación.
   *
   * Reutiliza la allow-list de IDs que ya existe en los filtros —la misma que
   * usa "Preguntale al mapa"— en vez de dibujar un mapa nuevo dentro de la
   * Fábrica.
   */
  const verEnMapa = useCallback((ids: string[]) => {
    territorial.setFilters({ ...initialTerritorialFilters, ids });
    window.location.hash = "#mapa";
  }, [territorial]);

  /** Localiza un cartel en el mapa de la página: lo selecciona (vuelo + ficha) y scrollea hasta él. */
  const locateCartel = (cartel: AnalyzedCartel) => {
    selectCartel(cartel);
    document.querySelector('[data-tour="map-canvas"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return <>
    <Header/>
    <main className="relative z-[1]">
      {mostrarConfiguracion ? (
        <Configuracion onVolver={() => { window.location.hash = "#inicio"; }}/>
      ) : mostrarFabrica ? (
        <Fabrica
          onVolver={() => { window.location.hash = "#inicio"; }}
          carteles={territorial.carteles}
          onVerEnMapa={verEnMapa}
        />
      ) : (
        <>
          <div data-territorial-background-zone className="relative isolate overflow-hidden">
            <TryhardHeroMap/>
            <div className="relative z-[1]">
              <Hero/>
              <StatsCards cartelesCount={territorial.carteles.length} corridorsCount={territorial.corridors.features.length} loading={territorial.loading}/>
              <MapPreview carteles={territorial.filteredCarteles} allCarteles={territorial.carteles} corridors={territorial.corridors} allowedPlaces={territorial.allowedPlaces} filters={territorial.filters} onFilters={territorial.setFilters} loading={territorial.loading} error={territorial.error} onRetry={territorial.retry} administrativeSource={territorial.administrativeSource} linkedCount={territorial.linkedCount} selected={selectedCartel} onSelect={selectCartel}/>
            </div>
          </div>

          {/* Lo consultivo primero: es lo que ve un visitante y lo que se
              muestra en una presentación. El orden acá es el mismo que el del
              menú, para que hacer clic y scrollear lleven al mismo lugar. */}
          <CartelLibrary carteles={territorial.filteredCarteles} onLocate={locateCartel}/>
          <div id="normativa" data-tour="normativa" className="section-block pb-0"><NormativaAsk onOpenDocument={openDocumentById}/></div>
          <PdfLibrary onOpen={(document) => openDocument(document)}/>
          <CorridorsSection/>

          {/* Bloque de trabajo al final, separado de lo público. Cada sección se
              oculta sola sin la sesión o el rol correspondiente, así que para un
              visitante la página termina en Corredores. */}
          {auth.canRead && <hr className="page-shell mt-20 border-t border-slate-200"/>}
          <IndicadoresGestion/>
          <ExpedientesRegistro/>
          <ApprovalInbox/>
        </>
      )}
    </main>
    <footer className="relative z-[1] mt-20 border-t border-slate-200 bg-white/90 backdrop-blur-sm"><div className="page-shell flex flex-col justify-between gap-4 py-8 sm:flex-row sm:items-center"><div className="text-xs text-slate-400"><b className="block text-ink">Cartelería Urbana SMT</b>Municipalidad de San Miguel de Tucumán</div><span className="text-xs text-slate-400">Capas territoriales estáticas · GeoJSON</span></div></footer>
    {viewer && <PdfViewer document={viewer.document} page={viewer.page} onClose={() => setViewer(null)}/>}
    <ProductTour/>
    <Toaster/>
  </>;
}
