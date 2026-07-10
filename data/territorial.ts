export type AnalysisStatus = "dentro_corredor" | "cerca_lugar_permitido" | "fuera_zona_permitida";
export type TaxStatus = "paga" | "no_paga" | "deuda" | "sin_datos";
export type RegistryStatus = "registrado" | "no_registrado" | "incompleto" | "sin_datos";
export type EnablementStatus = "habilitado" | "habilitable" | "no_habilitable" | "requiere_revision";
export type TerritorialContext = "avenida_comercial" | "corredor" | "microcentro" | "escuela" | "hospital" | "plaza" | "zona_residencial" | "zona_patrimonial" | "estacion_servicio";
export type SupportType = "led" | "cartel_tradicional" | "medianera" | "cerca_obra" | "gigantografia";
export type ControlPriority = "baja" | "media" | "alta" | "critica";
export type AdministrativeVisualStatus = "habilitado" | "deuda" | "fuera_zona" | "no_registrado";
export type MainTerritorialFilter = "todos" | "fuera_corredor" | "dentro_corredor" | "no_paga" | "deuda" | "no_registrado" | "habilitado" | "habilitable" | "no_habilitable" | "prioridad_alta" | "zona_sensible";

export type TerritorialFilterState = {
  query: string;
  main: Exclude<MainTerritorialFilter, "todos">[];
  tax: TaxStatus[];
  registry: RegistryStatus[];
  enablement: EnablementStatus[];
  support: SupportType[];
  // Allow-list opcional de IDs (String(properties.id)). La usa "Preguntale al
  // mapa" para pintar el set exacto de una consulta que no se puede expresar con
  // los filtros estructurados. null/undefined = sin restricción por ID.
  ids?: string[] | null;
};

export const initialTerritorialFilters: TerritorialFilterState = { query: "", main: [], tax: [], registry: [], enablement: [], support: [], ids: null };

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
    administrative?: {
      recordId: string;
      empresa: string;
      cuit: string;
      tipoCartel: string;
      dimensiones: string;
      superficieM2: number | null;
      domicilio: string;
      numero: string;
      padronCisi: string;
      estado: string;
      locationEdited: boolean;
    };
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

export const administrativeLabels: Record<AdministrativeVisualStatus, string> = {
  habilitado: "Habilitado",
  deuda: "Con deuda",
  fuera_zona: "Fuera de zona permitida",
  no_registrado: "No registrado"
};

export const administrativeColors: Record<AdministrativeVisualStatus, string> = {
  habilitado: "#16a34a",
  deuda: "#eab308",
  fuera_zona: "#f97316",
  no_registrado: "#dc2626"
};

export function getAdministrativeVisualStatus(cartel: AnalyzedCartel): AdministrativeVisualStatus {
  const properties = cartel.properties;
  if (properties.registryStatus === "no_registrado") return "no_registrado";
  if (properties.analysisStatus === "fuera_zona_permitida") return "fuera_zona";
  if (properties.taxStatus === "deuda") return "deuda";
  return "habilitado";
}

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
    const normalizedQuery = filters.query.trim().toLocaleLowerCase("es");
    const searchableText = [p.id, p.name, p.description, p.nearestCorridor, p.nearestAllowedPlace]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("es");
    const queryMatches = normalizedQuery.length === 0 || searchableText.includes(normalizedQuery);
    const mainMatches = filters.main.length === 0 || filters.main.some(filter =>
      (filter === "fuera_corredor" && getAdministrativeVisualStatus(cartel) === "fuera_zona")
      || (filter === "dentro_corredor" && p.analysisStatus === "dentro_corredor")
      || (filter === "no_paga" && p.taxStatus === "no_paga")
      || (filter === "deuda" && getAdministrativeVisualStatus(cartel) === "deuda")
      || (filter === "no_registrado" && getAdministrativeVisualStatus(cartel) === "no_registrado")
      || (filter === "habilitado" && getAdministrativeVisualStatus(cartel) === "habilitado")
      || (filter === "habilitable" && p.enablementStatus === "habilitable")
      || (filter === "no_habilitable" && p.enablementStatus === "no_habilitable")
      || (filter === "prioridad_alta" && (p.controlPriority === "alta" || p.controlPriority === "critica"))
      || (filter === "zona_sensible" && p.sensitiveZone)
    );
    const idMatches = filters.ids == null || filters.ids.includes(String(p.id));
    return queryMatches && mainMatches && idMatches
      && (filters.tax.length === 0 || filters.tax.includes(p.taxStatus))
      && (filters.registry.length === 0 || filters.registry.includes(p.registryStatus))
      && (filters.enablement.length === 0 || filters.enablement.includes(p.enablementStatus))
      && (filters.support.length === 0 || filters.support.includes(p.supportType));
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
