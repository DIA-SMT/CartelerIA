/**
 * Corte de un texto normativo por artículo.
 *
 * El mismo corte alimenta dos cosas distintas: el índice de búsqueda del corpus
 * y el articulado inicial del proyecto. Por eso vive acá y no dentro del script
 * de ingesta: así se puede probar sin base ni credenciales.
 *
 * La unidad de cita de una ordenanza es el artículo, no una ventana de N
 * caracteres. `rag_chunks.seccion` existe para eso y pesa A en el índice
 * léxico, así que cortar por artículo mejora la recuperación además de habilitar
 * la siembra.
 */

/** Un artículo detectado en el texto fuente. */
export interface ArticuloDetectado {
  numero: number;
  /** El título breve que sigue al número, si el texto lo trae. */
  sumilla: string | null;
  /** Cuerpo del artículo, sin la línea del encabezado. */
  texto: string;
  /** Etiqueta canónica para `rag_chunks.seccion`. */
  seccion: string;
}

export interface CorteArticulado {
  articulos: ArticuloDetectado[];
  /** Títulos encontrados, en orden. Contexto, no se siembran. */
  titulos: string[];
  /**
   * false cuando el texto no tiene una estructura de artículos reconocible.
   * En ese caso NO se siembra articulado: inventar una numeración es peor que
   * no tenerla.
   */
  estructurado: boolean;
  avisos: string[];
}

/**
 * Encabezado de artículo. Acepta las formas que aparecen en la práctica:
 * "Artículo 1.—", "Artículo 1º", "ARTÍCULO 12.-", "Art. 5:".
 * El guion largo del borrador municipal (—) es el caso principal.
 */
const ENCABEZADO_ARTICULO = /^\s*art(?:[íi]culo|\.?)\s*(\d{1,3})\s*(?:bis|ter)?\s*[.\-—–º°:]*\s*(.*)$/i;

const ENCABEZADO_TITULO = /^\s*(t[íi]tulo|cap[íi]tulo|anexo)\s+([ivxlcdm\d]+)\s*[.\-—–:]*\s*(.*)$/i;

/** Un encabezado no debería traer un párrafo entero pegado detrás. */
const MAX_SUMILLA = 160;

function normalizarEspacios(texto: string): string {
  return texto.replace(/­/g, "").replace(/[ \t ]+/g, " ").trim();
}

/**
 * Corta un texto en artículos a partir de sus párrafos.
 *
 * Recibe párrafos y no un string entero a propósito: en un `.docx` el salto de
 * párrafo es información real y confiable, y perderla obligaría a adivinar
 * dónde termina un encabezado.
 */
export function cortarPorArticulo(parrafos: string[]): CorteArticulado {
  const avisos: string[] = [];
  const titulos: string[] = [];
  const articulos: ArticuloDetectado[] = [];

  let actual: { numero: number; sumilla: string | null; cuerpo: string[] } | null = null;

  const cerrar = () => {
    if (!actual) return;
    const texto = normalizarEspacios(actual.cuerpo.join("\n"));
    articulos.push({
      numero: actual.numero,
      sumilla: actual.sumilla,
      texto,
      seccion: `Artículo ${actual.numero}`,
    });
    actual = null;
  };

  for (const crudo of parrafos) {
    const parrafo = normalizarEspacios(crudo);
    if (!parrafo) continue;

    const titulo = parrafo.match(ENCABEZADO_TITULO);
    if (titulo && parrafo.length <= MAX_SUMILLA) {
      titulos.push(parrafo);
      continue;
    }

    const encabezado = parrafo.match(ENCABEZADO_ARTICULO);
    if (encabezado) {
      const numero = Number.parseInt(encabezado[1], 10);
      const resto = normalizarEspacios(encabezado[2] ?? "");
      // Si detrás del número viene un párrafo entero, no es una sumilla: es el
      // cuerpo pegado al encabezado. Se conserva como cuerpo.
      const esSumilla = resto.length > 0 && resto.length <= MAX_SUMILLA;
      cerrar();
      actual = {
        numero,
        sumilla: esSumilla ? resto : null,
        cuerpo: esSumilla || !resto ? [] : [resto],
      };
      continue;
    }

    if (actual) actual.cuerpo.push(parrafo);
  }
  cerrar();

  if (articulos.length === 0) {
    return {
      articulos: [],
      titulos,
      estructurado: false,
      avisos: ["No se reconoció ninguna estructura de artículos."],
    };
  }

  // Un artículo vacío casi siempre indica un encabezado mal detectado.
  const vacios = articulos.filter((articulo) => articulo.texto.length < 20);
  if (vacios.length > 0) {
    avisos.push(
      `${vacios.length} artículo(s) quedaron sin cuerpo: ${vacios.map((a) => a.numero).join(", ")}.`,
    );
  }

  // Se informa, no se corrige: renumerar por nuestra cuenta sería inventar.
  const numeros = articulos.map((articulo) => articulo.numero);
  const repetidos = numeros.filter((numero, indice) => numeros.indexOf(numero) !== indice);
  if (repetidos.length > 0) {
    avisos.push(`Números de artículo repetidos: ${Array.from(new Set(repetidos)).join(", ")}.`);
  }
  const faltantes: number[] = [];
  for (let numero = 1; numero <= Math.max(...numeros); numero += 1) {
    if (!numeros.includes(numero)) faltantes.push(numero);
  }
  if (faltantes.length > 0) {
    avisos.push(`Faltan los artículos ${faltantes.join(", ")} en la numeración del borrador.`);
  }

  return { articulos, titulos, estructurado: true, avisos };
}

/**
 * Fragmentos para el índice, uno o más por artículo.
 *
 * Un artículo largo se parte, pero todos sus pedazos comparten `seccion`: la
 * cita sigue siendo el artículo entero aunque el fragmento sea parcial.
 */
export function fragmentarArticulo(
  articulo: ArticuloDetectado,
  maximo = 1200,
): { seccion: string; contenido: string }[] {
  const encabezado = articulo.sumilla
    ? `Artículo ${articulo.numero}.— ${articulo.sumilla}`
    : `Artículo ${articulo.numero}.—`;
  const completo = `${encabezado}\n${articulo.texto}`.trim();
  if (completo.length <= maximo) {
    return [{ seccion: articulo.seccion, contenido: completo }];
  }

  const partes: { seccion: string; contenido: string }[] = [];
  let resto = completo;
  while (resto.length > 0) {
    if (resto.length <= maximo) {
      partes.push({ seccion: articulo.seccion, contenido: resto.trim() });
      break;
    }
    // Se corta en el final de oración más cercano, para no partir una idea al
    // medio: un fragmento que empieza en mitad de una frase se cita mal.
    const ventana = resto.slice(0, maximo);
    const corte = ventana.lastIndexOf(". ");
    const fin = corte > maximo * 0.5 ? corte + 1 : maximo;
    partes.push({ seccion: articulo.seccion, contenido: resto.slice(0, fin).trim() });
    resto = resto.slice(fin).trim();
  }
  return partes.filter((parte) => parte.contenido.length > 0);
}
