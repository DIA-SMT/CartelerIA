// ============================================================================
// Tour de bienvenida (guiado paso a paso). Define las paradas del recorrido.
// El motor vive en components/product-tour.tsx. Anclas: `selector` apunta a un
// elemento del DOM (data-tour o id). `selector: null` = tarjeta centrada.
// ============================================================================

export interface TourStep {
  id: string;
  /** Selector CSS del elemento a resaltar. null = tarjeta centrada, sin ancla. */
  selector: string | null;
  title: string;
  body: string;
}

/** Se versiona la clave: si algún día cambia el tour, vuelve a mostrarse. */
export const TOUR_STORAGE_KEY = "carteleria_tour_v1";
/** Evento global para lanzar el tour manualmente (botón "¿Cómo funciona?"). */
export const TOUR_EVENT = "carteleria:tour";

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    selector: null,
    title: "Bienvenido a CartelerIA",
    body: "El visualizador de cartelería urbana de San Miguel de Tucumán. Te muestro lo principal en un minuto. Podés saltarlo cuando quieras.",
  },
  {
    id: "map",
    selector: '[data-tour="map-canvas"]',
    title: "El mapa territorial",
    body: "Cada punto es un cartel relevado y las líneas son los corredores publicitarios. El color indica la situación administrativa de cada cartel. Hacé clic en un cartel para abrir su ficha completa.",
  },
  {
    id: "diagnostico",
    selector: '[data-tour="diagnostico"]',
    title: "Diagnóstico territorial",
    body: "Tocá un indicador para filtrar al instante: total de carteles, dentro de corredores, fuera de zona permitida y su porcentaje.",
  },
  {
    id: "map-ask",
    selector: '[data-tour="map-ask"]',
    title: "Preguntale al mapa",
    body: "Escribí una pregunta en lenguaje natural (“¿cuántos están fuera de zona?”). La respuesta se calcula sobre los datos reales y puede aplicar el filtro en el mapa.",
  },
  {
    id: "normativa",
    selector: '[data-tour="normativa"]',
    title: "Consultar la normativa",
    body: "Preguntá sobre los documentos y la normativa municipal. El asistente responde citando la fuente, con un botón para abrir el PDF en la página exacta. Debajo está la biblioteca completa.",
  },
  {
    id: "expedientes",
    selector: "#expedientes",
    title: "Gestión y expedientes",
    body: "Con tu cuenta municipal desbloqueás la gestión: inspecciones, un expediente por cartel y reportes exportables en PDF y Excel.",
  },
  {
    id: "done",
    selector: null,
    title: "¡Listo!",
    body: "Ya conocés lo esencial. Podés repetir este recorrido cuando quieras con el botón “¿Cómo funciona?” del encabezado.",
  },
];
