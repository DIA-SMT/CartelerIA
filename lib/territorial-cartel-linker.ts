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
  const byTerritorialId = new Map(
    administrativeCarteles
      .filter((cartel) => cartel.territorialFeatureId)
      .map((cartel) => [String(cartel.territorialFeatureId), cartel]),
  );
  let linkedCount = 0;

  const carteles = territorialCarteles.map((feature) => {
    const record = byTerritorialId.get(String(feature.properties.id));
    if (!record) return feature;
    linkedCount += 1;

    return {
      ...feature,
      properties: {
        ...feature.properties,
        administrative: {
          recordId: record.id,
          empresa: record.empresa,
          cuit: record.cuit,
          tipoCartel: record.tipoCartel,
          dimensiones: record.dimensiones,
          superficieM2: record.superficieM2,
          domicilio: record.domicilio,
          numero: record.numero,
          padronCisi: record.padronCisi,
          estado: record.estado,
          locationEdited: record.locationEdited,
        },
      },
    };
  });

  return { carteles, linkedCount };
}
