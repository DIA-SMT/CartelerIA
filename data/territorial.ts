export type AnalysisStatus = "dentro_corredor" | "cerca_lugar_permitido" | "fuera_zona_permitida";
export type TaxStatus = "paga" | "no_paga" | "deuda" | "sin_datos";
export type RegistryStatus = "registrado" | "no_registrado" | "incompleto" | "sin_datos";
export type EnablementStatus = "habilitado" | "habilitable" | "no_habilitable" | "requiere_revision";
export type TerritorialContext = "avenida_comercial" | "corredor" | "microcentro" | "escuela" | "hospital" | "plaza" | "zona_residencial" | "zona_patrimonial" | "estacion_servicio";
export type SupportType = "led" | "cartel_tradicional" | "medianera" | "cerca_obra" | "gigantografia";
export type ControlPriority = "baja" | "media" | "alta" | "critica";
export type MainTerritorialFilter = "todos" | "fuera_corredor" | "dentro_corredor" | "no_paga" | "deuda" | "no_registrado" | "habilitado" | "habilitable" | "no_habilitable" | "prioridad_alta" | "zona_sensible";

export type TerritorialFilterState = {
  main: MainTerritorialFilter;
  tax: "todos" | TaxStatus;
  registry: "todos" | RegistryStatus;
  enablement: "todos" | EnablementStatus;
  context: "todos" | TerritorialContext;
  support: "todos" | SupportType;
};

export const initialTerritorialFilters: TerritorialFilterState = { main: "todos", tax: "todos", registry: "todos", enablement: "todos", context: "todos", support: "todos" };

export type GeoPoint = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: Record<string, unknown>;
};

export type GeoLine = {
  type: "Feature";
  geometry: { type: "LineString" | "MultiLineString"; coordinates: unknown };
  properties: Record<string, unknown>;
};

export type FeatureCollection<T> = { type: "FeatureCollection"; features: T[] };

export type AnalyzedCartel = GeoPoint & {
  properties: {
    id: number | string;
    name?: string;
    description?: string;
    analysisStatus: AnalysisStatus;
    nearestCorridor?: string;
    distanceToCorridorM?: number;
    nearestAllowedPlace?: string;
    distanceToAllowedPlaceM?: number;
    taxStatus: TaxStatus;
    registryStatus: RegistryStatus;
    enablementStatus: EnablementStatus;
    territorialContext: TerritorialContext;
    supportType: SupportType;
    controlPriority: ControlPriority;
    sensitiveZone: boolean;
    [key: string]: unknown;
  };
};

export const analysisLabels: Record<AnalysisStatus, string> = {
  dentro_corredor: "Dentro de corredor",
  cerca_lugar_permitido: "Requiere revisión",
  fuera_zona_permitida: "Fuera de zona permitida"
};

export const analysisColors: Record<AnalysisStatus, string> = {
  dentro_corredor: "#0f766e",
  cerca_lugar_permitido: "#eab308",
  fuera_zona_permitida: "#dc2626"
};

export const CORRIDOR_BUFFER_M = 75;
export const ALLOWED_PLACE_REVIEW_BUFFER_M = 150;

function applyReviewBuffer(carteles: FeatureCollection<AnalyzedCartel>): FeatureCollection<AnalyzedCartel> {
  const taxes: TaxStatus[] = ["paga", "no_paga", "deuda", "sin_datos"];
  const registries: RegistryStatus[] = ["registrado", "no_registrado", "incompleto", "sin_datos"];
  const enablements: EnablementStatus[] = ["habilitado", "habilitable", "no_habilitable", "requiere_revision"];
  const contexts: TerritorialContext[] = ["avenida_comercial", "corredor", "microcentro", "escuela", "hospital", "plaza", "zona_residencial", "zona_patrimonial", "estacion_servicio"];
  const supports: SupportType[] = ["led", "cartel_tradicional", "medianera", "cerca_obra", "gigantografia"];
  return {
    ...carteles,
    features: carteles.features.map((cartel, index) => {
      const originalStatus = cartel.properties.analysisStatus;
      const distanceToAllowedPlace = Number(cartel.properties.distanceToAllowedPlaceM);
      const analysisStatus: AnalysisStatus = originalStatus !== "dentro_corredor" && Number.isFinite(distanceToAllowedPlace) && distanceToAllowedPlace <= ALLOWED_PLACE_REVIEW_BUFFER_M
        ? "cerca_lugar_permitido"
        : originalStatus;
      const controlPriority: ControlPriority = analysisStatus === "fuera_zona_permitida" ? (index % 4 === 0 ? "critica" : "alta") : analysisStatus === "cerca_lugar_permitido" ? "media" : (index % 3 === 0 ? "media" : "baja");
      return { ...cartel, properties: { ...cartel.properties, analysisStatus, permittedPointBufferM: ALLOWED_PLACE_REVIEW_BUFFER_M, taxStatus: taxes[index % taxes.length], registryStatus: registries[(index * 3) % registries.length], enablementStatus: enablements[(index * 5) % enablements.length], territorialContext: contexts[(index * 7) % contexts.length], supportType: supports[(index * 3) % supports.length], controlPriority, sensitiveZone: ["escuela", "hospital", "plaza", "zona_patrimonial"].includes(contexts[(index * 7) % contexts.length]) } };
    })
  };
}

export function filterTerritorialCarteles(carteles: AnalyzedCartel[], filters: TerritorialFilterState) {
  return carteles.filter(cartel => {
    const p = cartel.properties;
    const mainMatches = filters.main === "todos"
      || (filters.main === "fuera_corredor" && p.analysisStatus !== "dentro_corredor")
      || (filters.main === "dentro_corredor" && p.analysisStatus === "dentro_corredor")
      || (filters.main === "no_paga" && p.taxStatus === "no_paga")
      || (filters.main === "deuda" && p.taxStatus === "deuda")
      || (filters.main === "no_registrado" && p.registryStatus === "no_registrado")
      || (filters.main === "habilitado" && p.enablementStatus === "habilitado")
      || (filters.main === "habilitable" && p.enablementStatus === "habilitable")
      || (filters.main === "no_habilitable" && p.enablementStatus === "no_habilitable")
      || (filters.main === "prioridad_alta" && (p.controlPriority === "alta" || p.controlPriority === "critica"))
      || (filters.main === "zona_sensible" && p.sensitiveZone);
    return mainMatches
      && (filters.tax === "todos" || p.taxStatus === filters.tax)
      && (filters.registry === "todos" || p.registryStatus === filters.registry)
      && (filters.enablement === "todos" || p.enablementStatus === filters.enablement)
      && (filters.context === "todos" || p.territorialContext === filters.context)
      && (filters.support === "todos" || p.supportType === filters.support);
  });
}

export async function loadTerritorialLayers() {
  return {
    corridors: corridorsData as unknown as FeatureCollection<GeoLine>,
    allowedPlaces: allowedPlacesData as unknown as FeatureCollection<GeoPoint>,
    surveyed: surveyedData as unknown as FeatureCollection<GeoPoint>,
    analyzed: applyReviewBuffer(analyzedData as unknown as FeatureCollection<AnalyzedCartel>)
  };
}
import corridorsData from "@/public/data/corredores.json";
import allowedPlacesData from "@/public/data/lugares_permitidos.json";
import surveyedData from "@/public/data/carteles_propaganda.json";
import analyzedData from "@/public/data/carteles_analizados_buffer75.json";
