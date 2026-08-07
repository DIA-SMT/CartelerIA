import type { AnalyzedCartel } from "@/data/territorial";

/**
 * Simulación determinística de un artículo contra los carteles relevados.
 *
 * Sin llamadas a ningún modelo. El asistente propone los parámetros y una
 * persona los confirma; acá solo se evalúan. Que este archivo sea determinístico
 * es lo que permite decirle a una autoridad "estos son los 47 carteles" y que el
 * número sea el mismo mañana.
 */

/** Parámetros que el simulador sabe evaluar. */
export type ClaveParametro =
  | "superficie_maxima_m2"
  | "distancia_minima_corredor_m"
  | "distancia_minima_lugar_permitido_m"
  | "zonas_habilitadas";

export const PARAMETRO_LABELS: Record<ClaveParametro, string> = {
  superficie_maxima_m2: "Superficie máxima",
  distancia_minima_corredor_m: "Distancia mínima al corredor",
  distancia_minima_lugar_permitido_m: "Distancia mínima a lugar permitido",
  zonas_habilitadas: "Zonas habilitadas",
};

/** Campo del relevamiento del que depende cada parámetro. */
export const PARAMETRO_CAMPO: Record<ClaveParametro, string> = {
  superficie_maxima_m2: "superficie declarada",
  distancia_minima_corredor_m: "distancia al corredor",
  distancia_minima_lugar_permitido_m: "distancia a lugar permitido",
  zonas_habilitadas: "situación territorial",
};

export function esClaveParametro(value: unknown): value is ClaveParametro {
  return typeof value === "string" && value in PARAMETRO_LABELS;
}

export interface ParametroConfirmado {
  clave: ClaveParametro;
  /** Numérico para los máximos y mínimos; lista de valores para las zonas. */
  valor: number | string[];
  unidad: string | null;
  confirmado: boolean;
}

export type Cumplimiento = "cumple" | "no_cumple" | "no_evaluable";

export interface ResultadoCartel {
  cartelId: string;
  cumplimiento: Cumplimiento;
  /** Por qué no se pudo evaluar. Solo cuando `no_evaluable`. */
  faltante: string | null;
  zona: string;
}

export interface ResumenSimulacion {
  cumple: number;
  noCumple: number;
  noEvaluable: number;
  total: number;
  /** Cuántos quedaron sin evaluar por cada campo faltante. */
  faltantes: { campo: string; cantidad: number }[];
  porZona: { zona: string; cumple: number; noCumple: number; noEvaluable: number }[];
  /** Identificadores para "ver en el mapa", sin traer el cartel entero. */
  idsNoCumple: string[];
}

export class ParametroSinConfirmarError extends Error {
  /**
   * Campo declarado aparte en vez de usar una propiedad de parámetro: el
   * `--experimental-strip-types` con el que corren los tests solo borra tipos,
   * no transforma azúcar sintáctico.
   */
  readonly claves: ClaveParametro[];

  constructor(claves: ClaveParametro[]) {
    super(
      `Hay parámetros sin confirmar por una persona: ${claves.join(", ")}. La simulación no corre con supuestos.`,
    );
    this.name = "ParametroSinConfirmarError";
    this.claves = claves;
  }
}

function numero(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

/**
 * Evalúa un cartel contra un parámetro.
 *
 * Devuelve `no_evaluable` cuando falta el dato, y eso es deliberado: un cartel
 * sin superficie cargada no cumple ni incumple. Contarlo como que cumple le da
 * a una autoridad un número tranquilizador que es falso; contarlo como que no
 * cumple infla el impacto. Falta información, y así se dice.
 */
function evaluarParametro(
  cartel: AnalyzedCartel,
  parametro: ParametroConfirmado,
): { cumplimiento: Cumplimiento; faltante: string | null } {
  const propiedades = cartel.properties;

  switch (parametro.clave) {
    case "superficie_maxima_m2": {
      const superficie = numero(propiedades.administrative?.superficieM2);
      const maximo = numero(parametro.valor);
      if (superficie === null || maximo === null) {
        return { cumplimiento: "no_evaluable", faltante: PARAMETRO_CAMPO.superficie_maxima_m2 };
      }
      return { cumplimiento: superficie <= maximo ? "cumple" : "no_cumple", faltante: null };
    }
    case "distancia_minima_corredor_m": {
      const distancia = numero(propiedades.distanceToCorridorM);
      const minimo = numero(parametro.valor);
      if (distancia === null || minimo === null) {
        return { cumplimiento: "no_evaluable", faltante: PARAMETRO_CAMPO.distancia_minima_corredor_m };
      }
      return { cumplimiento: distancia >= minimo ? "cumple" : "no_cumple", faltante: null };
    }
    case "distancia_minima_lugar_permitido_m": {
      const distancia = numero(propiedades.distanceToAllowedPlaceM);
      const minimo = numero(parametro.valor);
      if (distancia === null || minimo === null) {
        return {
          cumplimiento: "no_evaluable",
          faltante: PARAMETRO_CAMPO.distancia_minima_lugar_permitido_m,
        };
      }
      return { cumplimiento: distancia >= minimo ? "cumple" : "no_cumple", faltante: null };
    }
    case "zonas_habilitadas": {
      const permitidas = Array.isArray(parametro.valor) ? parametro.valor : null;
      const situacion = propiedades.analysisStatus;
      if (!permitidas || permitidas.length === 0 || typeof situacion !== "string") {
        return { cumplimiento: "no_evaluable", faltante: PARAMETRO_CAMPO.zonas_habilitadas };
      }
      return { cumplimiento: permitidas.includes(situacion) ? "cumple" : "no_cumple", faltante: null };
    }
  }
}

/**
 * Corre la simulación de un artículo sobre los carteles relevados.
 *
 * Un cartel cumple solo si cumple TODOS los parámetros. Si alguno no se puede
 * evaluar y ninguno da incumplimiento, el cartel queda `no_evaluable`: no se
 * puede afirmar que cumpla sin haber mirado todo. En cambio un incumplimiento
 * comprobado alcanza para decir que no cumple, aunque falte otro dato.
 *
 * Lanza si algún parámetro no fue confirmado por una persona. La simulación no
 * corre con supuestos ni los ignora en silencio.
 */
export function simularArticulo(
  carteles: AnalyzedCartel[],
  parametros: ParametroConfirmado[],
): { resultados: ResultadoCartel[]; resumen: ResumenSimulacion } {
  const sinConfirmar = parametros.filter((parametro) => !parametro.confirmado);
  if (sinConfirmar.length > 0) {
    throw new ParametroSinConfirmarError(sinConfirmar.map((parametro) => parametro.clave));
  }

  const resultados: ResultadoCartel[] = carteles.map((cartel) => {
    const cartelId = String(cartel.properties.id);
    const zona = typeof cartel.properties.territorialContext === "string"
      ? cartel.properties.territorialContext
      : "sin_datos";

    if (parametros.length === 0) {
      return { cartelId, cumplimiento: "no_evaluable", faltante: "parámetros del artículo", zona };
    }

    let incumple = false;
    let faltante: string | null = null;
    for (const parametro of parametros) {
      const evaluacion = evaluarParametro(cartel, parametro);
      if (evaluacion.cumplimiento === "no_cumple") incumple = true;
      if (evaluacion.cumplimiento === "no_evaluable" && faltante === null) {
        faltante = evaluacion.faltante;
      }
    }

    // Un incumplimiento comprobado manda sobre un dato faltante: ya se sabe que
    // no cumple, aunque no se sepa todo lo demás.
    if (incumple) return { cartelId, cumplimiento: "no_cumple", faltante: null, zona };
    if (faltante !== null) return { cartelId, cumplimiento: "no_evaluable", faltante, zona };
    return { cartelId, cumplimiento: "cumple", faltante: null, zona };
  });

  const faltantes = new Map<string, number>();
  const zonas = new Map<string, { cumple: number; noCumple: number; noEvaluable: number }>();
  for (const resultado of resultados) {
    if (resultado.faltante) {
      faltantes.set(resultado.faltante, (faltantes.get(resultado.faltante) ?? 0) + 1);
    }
    const acumulado = zonas.get(resultado.zona)
      ?? { cumple: 0, noCumple: 0, noEvaluable: 0 };
    if (resultado.cumplimiento === "cumple") acumulado.cumple += 1;
    else if (resultado.cumplimiento === "no_cumple") acumulado.noCumple += 1;
    else acumulado.noEvaluable += 1;
    zonas.set(resultado.zona, acumulado);
  }

  return {
    resultados,
    resumen: {
      cumple: resultados.filter((item) => item.cumplimiento === "cumple").length,
      noCumple: resultados.filter((item) => item.cumplimiento === "no_cumple").length,
      noEvaluable: resultados.filter((item) => item.cumplimiento === "no_evaluable").length,
      total: resultados.length,
      faltantes: Array.from(faltantes.entries())
        .map(([campo, cantidad]) => ({ campo, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad),
      porZona: Array.from(zonas.entries())
        .map(([zona, valores]) => ({ zona, ...valores }))
        .sort((a, b) => b.noCumple - a.noCumple || a.zona.localeCompare(b.zona, "es")),
      idsNoCumple: resultados
        .filter((item) => item.cumplimiento === "no_cumple")
        .map((item) => item.cartelId),
    },
  };
}
