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
export function localizarCita(cita: string, fragmentosSaneados: string[]): string | null {
  const buscada = sanearFragmento(cita);
  if (buscada.length < CITA_MIN) return null;
  const aguja = buscada.toLowerCase();
  for (const fragmento of fragmentosSaneados) {
    const posicion = fragmento.toLowerCase().indexOf(aguja);
    if (posicion !== -1) return fragmento.slice(posicion, posicion + buscada.length);
  }
  return null;
}

export function citaVerifica(cita: string, fragmentosSaneados: string[]): boolean {
  return localizarCita(cita, fragmentosSaneados) !== null;
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
    const enLaFuente = localizarCita(cita, fragmentosSaneados);
    if (enLaFuente === null) {
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
      // La de la fuente, no la que escribió el modelo: lo que se muestra tiene
      // que ser literalmente lo que dice el artículo.
      cita: enLaFuente,
      // Ante la duda, baja: aceptar un hallazgo tiene que ser deliberado.
      confianza: esConfianza(hallazgo.confianza) ? hallazgo.confianza : "baja",
    });
  }

  return { verificados, descartados };
}
