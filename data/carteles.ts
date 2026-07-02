import rawCarteles from "./carteles.json";

export type CartelStatus = "Relevado" | "Normativa" | "Proyecto";
export type SituationStatus = "relevado" | "habilitado" | "pendiente" | "observado" | "infraccion" | "sin_datos";
export type ContaminationLevel = "bajo" | "medio" | "alto" | "critico";

export interface CartelRecord {
  id: string;
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

function inferZone(address: string) {
  const value = address.toLocaleUpperCase("es-AR");
  if (value.includes("MATE DE LUNA")) return "Av. Mate de Luna";
  if (value.includes("BELGRANO")) return "Av. Belgrano";
  if (value.includes("ALEM")) return "Av. Alem";
  if (value.includes("ROCA")) return "Av. Roca";
  if (["SAN MARTIN", "24 DE SEPTIEMBRE", "CONGRESO", "LAPRIDA", "MAIPU"].some(street => value.includes(street))) return "Microcentro";
  return "Otros sectores";
}

function mockSituation(index: number, located: boolean): SituationStatus {
  if (!located) return "sin_datos";
  return (["relevado", "habilitado", "pendiente", "observado", "infraccion", "relevado"] as SituationStatus[])[index % 6];
}

function mockContamination(index: number): ContaminationLevel {
  return (["bajo", "medio", "medio", "alto", "alto", "critico"] as ContaminationLevel[])[index % 6];
}

export const initialCarteles = (rawCarteles as unknown as CartelRecord[]).map((cartel, index) => {
  const located = cartel.latitud != null && cartel.longitud != null;
  return {
    ...cartel,
    status: mockSituation(index, located),
    contaminationLevel: mockContamination(index),
    zone: inferZone(cartel.domicilio),
    streetViewImageUrl: null,
    originalLatitud: cartel.latitud,
    originalLongitud: cartel.longitud,
    locationEdited: false
  };
});

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
