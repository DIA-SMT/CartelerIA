/**
 * El archivo de OCR: leerlo, corregirlo y volver a escribirlo.
 *
 * Las correcciones tienen que volver a `data/ocr/<id>.json`, que es de donde el
 * ingest deriva los fragmentos. Si se guardaran solo en la base, la próxima
 * reingesta las pisaría sin avisar, que es exactamente cómo se perdió antes el
 * `estado_legal` del borrador.
 *
 * Dos cosas NO se tocan al corregir:
 *
 * - `sourceHash`, que ata el OCR a un PDF concreto. El ingest lo compara y, si
 *   no coincide, descarta el archivo entero con un aviso. Cambiarlo sería
 *   afirmar que este texto sale de un PDF del que no salió.
 * - `confianza` por página, que es una medición del motor de OCR. Bajarla o
 *   subirla porque una persona corrigió el texto sería falsear una medida. Lo
 *   que se agrega es otra cosa: la marca de que hubo corrección humana.
 */

export interface PaginaOcr {
  pagina: number;
  fuente?: "pdf" | "ocr";
  confianza?: number | null;
  texto: string;
  /** Se agrega al corregir. El ingest lo ignora; sirve como registro. */
  corregidaPorHumano?: boolean;
}

export interface ArchivoOcr {
  docId: string;
  titulo?: string;
  archivo?: string;
  sourceHash: string;
  ocrAplicado?: boolean;
  fecha?: string;
  modelo?: string;
  escala?: number;
  paginasTotal: number;
  paginasOcr?: number;
  confianzaMedia?: number | null;
  dudosa?: boolean;
  paginas: PaginaOcr[];
  /** Se agrega al corregir. */
  correccionHumana?: { fecha: string; paginas: number[] };
}

export interface ResultadoLectura {
  ok: boolean;
  archivo: ArchivoOcr | null;
  error: string | null;
}

/**
 * Valida lo mismo que valida el ingest antes de aceptar un archivo de OCR.
 *
 * Se comprueba acá para poder decir qué está mal mientras se edita, en vez de
 * descubrirlo cuando `ingest:docs` lo descarta con un aviso en la consola.
 */
export function leerArchivoOcr(crudo: string, documentoEsperado: string): ResultadoLectura {
  const fallo = (error: string): ResultadoLectura => ({ ok: false, archivo: null, error });

  let dato: unknown;
  try {
    dato = JSON.parse(crudo);
  } catch {
    return fallo("El archivo no es un JSON válido.");
  }
  if (!dato || typeof dato !== "object") return fallo("El archivo no tiene la forma esperada.");

  const raw = dato as Record<string, unknown>;
  if (raw.docId !== documentoEsperado) {
    return fallo(`Ese archivo es de ${String(raw.docId)}, no de ${documentoEsperado}.`);
  }
  if (typeof raw.sourceHash !== "string" || raw.sourceHash.length !== 64) {
    return fallo("El archivo no trae la huella del PDF del que salió.");
  }
  if (!Number.isInteger(raw.paginasTotal) || (raw.paginasTotal as number) <= 0) {
    return fallo("El archivo no declara cuántas páginas tiene.");
  }
  if (!Array.isArray(raw.paginas) || raw.paginas.length !== raw.paginasTotal) {
    return fallo("El archivo no contiene un juego completo de páginas.");
  }

  const paginas: PaginaOcr[] = [];
  for (const item of raw.paginas as Record<string, unknown>[]) {
    if (!Number.isInteger(item?.pagina) || typeof item?.texto !== "string") {
      return fallo("Alguna página no tiene número o texto.");
    }
    paginas.push({
      pagina: item.pagina as number,
      fuente: item.fuente === "pdf" || item.fuente === "ocr" ? item.fuente : undefined,
      confianza: typeof item.confianza === "number" ? item.confianza : null,
      texto: item.texto as string,
      corregidaPorHumano: item.corregidaPorHumano === true,
    });
  }
  paginas.sort((a, b) => a.pagina - b.pagina);
  if (paginas.some((pagina, indice) => pagina.pagina !== indice + 1)) {
    return fallo("Hay páginas faltantes, repetidas o fuera de orden.");
  }

  return {
    ok: true,
    error: null,
    archivo: { ...(raw as unknown as ArchivoOcr), paginas },
  };
}

/**
 * Arma el archivo corregido.
 *
 * `fecha` entra por parámetro para que la función sea determinística y se pueda
 * probar: una que llame a `new Date()` adentro no se puede comparar contra nada.
 */
export function aplicarCorreccion(
  original: ArchivoOcr,
  textos: string[],
  fecha: string,
): ArchivoOcr {
  const paginas = original.paginas.map((pagina, indice) => {
    const nuevo = textos[indice] ?? pagina.texto;
    const cambio = nuevo !== pagina.texto;
    return {
      ...pagina,
      texto: nuevo,
      // Una vez corregida, queda corregida aunque después no se toque más.
      corregidaPorHumano: cambio || pagina.corregidaPorHumano === true,
    };
  });

  const corregidas = paginas
    .filter((pagina) => pagina.corregidaPorHumano)
    .map((pagina) => pagina.pagina);

  return {
    ...original,
    paginas,
    ...(corregidas.length > 0 ? { correccionHumana: { fecha, paginas: corregidas } } : {}),
  };
}

/** Cuántas páginas cambiaron respecto del archivo abierto. */
export function contarCambios(original: ArchivoOcr, textos: string[]): number {
  return original.paginas.reduce(
    (total, pagina, indice) => total + (textos[indice] !== pagina.texto ? 1 : 0),
    0,
  );
}
