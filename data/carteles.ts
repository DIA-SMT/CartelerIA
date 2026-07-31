export type CartelStatus = "Relevado" | "Normativa" | "Proyecto";
export type SituationStatus = "relevado" | "habilitado" | "pendiente" | "observado" | "infraccion" | "sin_datos";
export type ContaminationLevel = "bajo" | "medio" | "alto" | "critico";
export type TerritorialLinkStatus = "sin_vinculo" | "pendiente" | "aprobado" | "rechazado";

export interface CartelRecord {
  id: string;
  territorialFeatureId?: string | null;
  proposedTerritorialFeatureId?: string | null;
  territorialLinkStatus?: TerritorialLinkStatus;
  empresa: string;
  cuit: string;
  tipoCartel: string;
  dimensiones: string;
  superficieM2: number | null;
  domicilio: string;
  numero: string;
  googleMapsUrl: string;
  padronCisi: string;
  estado: CartelStatus;
  latitud: number | null;
  longitud: number | null;
  locationSource?: "google_maps" | "nominatim" | "manual";
  status: SituationStatus;
  contaminationLevel: ContaminationLevel;
  zone: string;
  streetViewImageUrl: string | null;
  originalLatitud: number | null;
  originalLongitud: number | null;
  locationEdited: boolean;
}

export const situationLabels: Record<SituationStatus, string> = {
  relevado: "Relevado / ubicado",
  habilitado: "Habilitado",
  pendiente: "Pendiente de revisión",
  observado: "Observado",
  infraccion: "Posible infracción",
  sin_datos: "Sin datos suficientes"
};

export const situationColors: Record<SituationStatus, string> = {
  relevado: "#0868f7",
  habilitado: "#16a34a",
  pendiente: "#ffda00",
  observado: "#f97316",
  infraccion: "#dc2626",
  sin_datos: "#64748b"
};

export function cartelAddress(cartel: CartelRecord) {
  return [cartel.domicilio, cartel.numero].filter(Boolean).join(" · ");
}
