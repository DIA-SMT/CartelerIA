/**
 * Verificación de citas textuales.
 *
 * Esto es lo que efectivamente impide que el asistente invente. La instrucción
 * en el prompt no alcanza: hay que comprobar en código que cada cita aparezca
 * literalmente en el fragmento que el modelo vio, y descartar el hallazgo que
 * no lo cumpla.
 *
 * La trampa que cuesta una tarde: si el modelo ve un texto y la verificación
 * compara contra otro —porque uno de los dos pasó por una limpieza extra—,
 * TODA cita válida se descarta por una diferencia invisible. Por eso el saneado
 * es uno solo, `sanearFragmento`, y se aplica una única vez: el mismo string
 * que se manda al modelo es contra el que se verifica.
 */

/**
 * Único saneado permitido. Colapsa espacios y normaliza los caracteres que los
 * editores de texto cambian sin avisar (comillas curvas, guiones largos), pero
 * NO corrige el contenido: si el texto extraído dice `PO ZOENLAM ATERN ID AD`,
 * la cita tiene que decir exactamente eso.
 */
export function sanearFragmento(texto: string): string {
  return texto
    .replace(/­/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "—")
    .replace(/\s+/g, " ")
    .trim();
}

export type Confianza = "baja" | "media" | "alta";

export interface HallazgoSinVerificar {
  tipo: string;
  severidad: string;
  descripcion: string;
  referencia: string | null;
  cita: string;
  confianza?: string;
}

export interface HallazgoVerificado {
  tipo: string;
  severidad: string;
  descripcion: string;
  referencia: string | null;
  cita: string;
  /** Arranca en baja salvo que el modelo la eleve Y la cita verifique. */
  confianza: Confianza;
}

export interface ResultadoVerificacion {
  verificados: HallazgoVerificado[];
  /** Hallazgos descartados por cita que no aparece. Se registran, no se ocultan. */
  descartados: { descripcion: string; cita: string; motivo: string }[];
}

/** Una cita demasiado corta verifica por casualidad y no prueba nada. */
const CITA_MIN = 25;

function esConfianza(value: unknown): value is Confianza {
  return value === "baja" || value === "media" || value === "alta";
}

/**
 * Verifica que la cita aparezca literalmente en alguno de los fragmentos.
 *
 * Los fragmentos ya vienen saneados: son exactamente los que se le mandaron al
 * modelo. La cita se sanea con la MISMA función porque el modelo puede haber
 * normalizado un espacio al copiar, pero nada más.
 */
/**
 * Busca en el artículo la oración donde aparece un número, para proponerla como
 * cita sin que nadie tenga que copiarla a mano.
 *
 * PostgreSQL exige que la cita esté **textual** en el artículo, así que lo que
 * se devuelve es un recorte exacto del texto original: nada de normalizar
 * espacios ni arreglar la puntuación, porque eso rompería la comprobación.
 *
 * Devuelve `null` cuando no encuentra el número o cuando la oración es
 * demasiado corta para valer como cita. Proponer algo dudoso sería peor que no
 * proponer nada: la idea es ahorrar el copiar y pegar, no adivinar.
 */
export function proponerCitaParaValor(texto: string, valor: number): string | null {
  if (!Number.isFinite(valor) || texto.length === 0) return null;

  // El número tal como se escribiría en un artículo: "6", "6,5" o "6.5".
  const entero = String(valor);
  const conComa = entero.replace(".", ",");
  const patron = new RegExp(
    `(?<![\\d,.])(?:${[entero, conComa].map(escaparRegex).join("|")})(?![\\d,.])`,
  );

  for (const oracion of recortarOraciones(texto)) {
    const fragmento = texto.slice(oracion.inicio, oracion.fin).trim();
    if (fragmento.length < CITA_MIN) continue;
    if (patron.test(fragmento)) return fragmento;
  }
  return null;
}

function escaparRegex(valor: string): string {
  return valor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Cortes de oración con sus posiciones, para poder recortar el original. */
function recortarOraciones(texto: string): { inicio: number; fin: number }[] {
  const cortes: { inicio: number; fin: number }[] = [];
  let inicio = 0;
  for (let i = 0; i < texto.length; i += 1) {
    const caracter = texto[i]!;
    // El punto de una abreviatura o de un decimal no corta oración.
    const cortaAqui = caracter === "\n"
      || caracter === ";"
      || (caracter === "." && !/\d/.test(texto[i + 1] ?? "") && !/\d/.test(texto[i - 1] ?? ""));
    if (!cortaAqui) continue;
    cortes.push({ inicio, fin: i + 1 });
    inicio = i + 1;
  }
  if (inicio < texto.length) cortes.push({ inicio, fin: texto.length });
  return cortes;
}

export function citaVerifica(cita: string, fragmentosSaneados: string[]): boolean {
  const buscada = sanearFragmento(cita);
  if (buscada.length < CITA_MIN) return false;
  return fragmentosSaneados.some((fragmento) => fragmento.includes(buscada));
}

/**
 * Filtra los hallazgos que el modelo devolvió.
 *
 * Una lista vacía es una respuesta válida y frecuente: lo normal es que un
 * artículo no contradiga nada. Sin esa expectativa el modelo fabrica hallazgos
 * para llenar el formulario, y acá se descartan igual por no verificar.
 */
export function verificarHallazgos(
  hallazgos: HallazgoSinVerificar[],
  fragmentosSaneados: string[],
): ResultadoVerificacion {
  const verificados: HallazgoVerificado[] = [];
  const descartados: { descripcion: string; cita: string; motivo: string }[] = [];

  for (const hallazgo of hallazgos) {
    const cita = sanearFragmento(hallazgo.cita ?? "");
    if (cita.length < CITA_MIN) {
      descartados.push({
        descripcion: hallazgo.descripcion,
        cita,
        motivo: "la cita es demasiado corta para probar algo",
      });
      continue;
    }
    if (!citaVerifica(cita, fragmentosSaneados)) {
      descartados.push({
        descripcion: hallazgo.descripcion,
        cita,
        motivo: "la cita no aparece textualmente en la normativa recuperada",
      });
      continue;
    }
    verificados.push({
      tipo: hallazgo.tipo,
      severidad: hallazgo.severidad,
      descripcion: hallazgo.descripcion,
      referencia: hallazgo.referencia ?? null,
      cita,
      // Ante la duda, baja: aceptar un hallazgo tiene que ser deliberado.
      confianza: esConfianza(hallazgo.confianza) ? hallazgo.confianza : "baja",
    });
  }

  return { verificados, descartados };
}
