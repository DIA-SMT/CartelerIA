import type { CartelRecord } from "@/data/carteles";

/**
 * Qué pasaría con los carteles relevados si la ordenanza fijara tal máximo.
 *
 * Lee el **registro administrativo directo**, no el mapa. La versión anterior
 * leía los carteles ya unidos a la capa territorial, y ahí está el problema que
 * la hacía inservible: la superficie solo se adjunta cuando el vínculo
 * territorial está aprobado, y hoy hay 1 aprobado de 253. El simulador
 * calculaba sobre un cartel y devolvía "no evaluable" para el resto.
 *
 * Sobre el registro, la cobertura es otra: 249 de 253 tienen superficie, y el
 * tipo y la zona están completos. Ninguno de esos tres datos necesita geometría.
 *
 * Determinístico y sin modelo: el número que sale de acá se puede defender en
 * una reunión. Un cartel sin superficie no cuenta como que cumple — se informa
 * aparte, porque la diferencia entre "cumple" y "no sabemos" es justamente la
 * que no hay que perder.
 */

export interface CorteSimulacion {
  /** Nombre del grupo: un tipo de cartel o una zona. */
  etiqueta: string;
  total: number;
  superan: number;
  sinDato: number;
}

export interface ResumenSimulacion {
  /** Carteles del registro, con y sin superficie cargada. */
  total: number;
  /** Los que se pudieron evaluar. */
  conDato: number;
  /** Los que quedarían fuera de norma con ese máximo. */
  superan: number;
  /** Los que no se pueden evaluar porque les falta la superficie. */
  sinDato: number;
  /** Porcentaje sobre los evaluables, redondeado. 0 si no hay ninguno. */
  porcentaje: number;
  porTipo: CorteSimulacion[];
  porZona: CorteSimulacion[];
}

function agrupar(
  carteles: CartelRecord[],
  maximo: number,
  clave: (cartel: CartelRecord) => string,
): CorteSimulacion[] {
  const grupos = new Map<string, CorteSimulacion>();
  for (const cartel of carteles) {
    const etiqueta = clave(cartel) || "Sin dato";
    const grupo = grupos.get(etiqueta) ?? { etiqueta, total: 0, superan: 0, sinDato: 0 };
    grupo.total += 1;
    const superficie = cartel.superficieM2;
    if (typeof superficie !== "number" || !Number.isFinite(superficie)) grupo.sinDato += 1;
    else if (superficie > maximo) grupo.superan += 1;
    grupos.set(etiqueta, grupo);
  }
  return Array.from(grupos.values()).sort((a, b) => b.superan - a.superan || b.total - a.total);
}

export function simularSuperficieMaxima(
  carteles: CartelRecord[],
  maximo: number,
): ResumenSimulacion {
  const conDatoLista = carteles.filter((cartel) =>
    typeof cartel.superficieM2 === "number" && Number.isFinite(cartel.superficieM2));
  const superan = conDatoLista.filter((cartel) => (cartel.superficieM2 as number) > maximo).length;
  const conDato = conDatoLista.length;

  return {
    total: carteles.length,
    conDato,
    superan,
    sinDato: carteles.length - conDato,
    porcentaje: conDato === 0 ? 0 : Math.round((superan / conDato) * 100),
    porTipo: agrupar(carteles, maximo, (cartel) => cartel.tipoCartel),
    porZona: agrupar(carteles, maximo, (cartel) => cartel.zone),
  };
}

/**
 * Cómo se reparten las superficies, para elegir un máximo con criterio en vez
 * de a ojo. Sin esto hay que probar números hasta que uno "suene bien".
 */
export interface DistribucionSuperficie {
  minimo: number;
  mediana: number;
  maximo: number;
  /** Cuartiles, útiles para ver dónde está el grueso. */
  p25: number;
  p75: number;
}

export function distribucionSuperficie(carteles: CartelRecord[]): DistribucionSuperficie | null {
  const valores = carteles
    .map((cartel) => cartel.superficieM2)
    .filter((valor): valor is number => typeof valor === "number" && Number.isFinite(valor) && valor > 0)
    .sort((a, b) => a - b);
  if (valores.length === 0) return null;
  const en = (proporcion: number) => valores[Math.min(valores.length - 1, Math.floor(valores.length * proporcion))]!;
  return {
    minimo: valores[0]!,
    p25: en(0.25),
    mediana: en(0.5),
    p75: en(0.75),
    maximo: valores[valores.length - 1]!,
  };
}
