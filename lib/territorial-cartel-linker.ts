import type { CartelRecord } from "@/data/carteles";
import type { AnalyzedCartel } from "@/data/territorial";

export type TerritorialLinkResult = {
  carteles: AnalyzedCartel[];
  linkedCount: number;
};

/**
 * Vincula únicamente identificadores explícitos. No usa proximidad geográfica:
 * varios soportes pueden compartir una esquina y una unión aproximada sería riesgosa.
 */
export function linkAdministrativeCarteles(
  territorialCarteles: AnalyzedCartel[],
  administrativeCarteles: CartelRecord[],
): TerritorialLinkResult {
  const priority = (cartel: CartelRecord) => {
    if (cartel.territorialLinkStatus === "aprobado") return 3;
    if (cartel.territorialLinkStatus === "pendiente") return 2;
    if (cartel.territorialLinkStatus === "rechazado") return 1;
    return 0;
  };
  const byTerritorialId = new Map<string, CartelRecord>();
  for (const cartel of administrativeCarteles) {
    const featureId = cartel.territorialFeatureId ?? cartel.proposedTerritorialFeatureId;
    if (!featureId) continue;
    const key = String(featureId);
    const current = byTerritorialId.get(key);
    if (!current || priority(cartel) > priority(current)) {
      byTerritorialId.set(key, cartel);
    }
  }
  let linkedCount = 0;

  const carteles = territorialCarteles.map((feature) => {
    const record = byTerritorialId.get(String(feature.properties.id));
    if (!record) return feature;
    if (record.territorialLinkStatus === "aprobado") {
      linkedCount += 1;
    } else {
      return {
        ...feature,
        properties: {
          ...feature.properties,
          administrative: {
            recordId: record.id,
            linkStatus: record.territorialLinkStatus ?? "sin_vinculo",
          },
        },
      };
    }

    return {
      ...feature,
      properties: {
        ...feature.properties,
        administrative: {
          recordId: record.id,
          linkStatus: record.territorialLinkStatus ?? "sin_vinculo",
          // Los campos fiscales se omiten cuando la sesión no los recibió: así
          // el mapa nunca los transporta en una sesión consultiva.
          ...(record.empresa ? { empresa: record.empresa } : {}),
          ...(record.cuit ? { cuit: record.cuit } : {}),
          ...(record.padronCisi ? { padronCisi: record.padronCisi } : {}),
          tipoCartel: record.tipoCartel,
          dimensiones: record.dimensiones,
          superficieM2: record.superficieM2,
          domicilio: record.domicilio,
          numero: record.numero,
          estado: record.estado,
          locationEdited: record.locationEdited,
        },
      },
    };
  });

  return { carteles, linkedCount };
}
