/**
 * Qué artículos del propio documento se parecen a uno dado.
 *
 * Sirve para no mandarle al modelo los treinta y tres artículos en cada
 * consulta: la mayoría no tienen nada que ver con el que se está escribiendo, y
 * el ruido no solo cuesta plata sino que empeora la respuesta.
 *
 * Es deliberadamente simple —solapamiento de términos poco frecuentes— y no
 * usa base de datos ni modelo. Con treinta y tres artículos alcanza de sobra, y
 * si algún día no alcanza, se nota enseguida: el revisor deja de encontrar
 * choques que están a la vista.
 */

export interface ArticuloComparable {
  id: string;
  numero: number;
  sumilla: string | null;
  texto: string;
}

/**
 * Palabras que aparecen en casi todos los artículos de una ordenanza y por eso
 * no distinguen nada. No es una lista de stopwords del español: es una lista de
 * ruido de este dominio, más la gramática que sobrevive al corte por longitud.
 */
const RUIDO = new Set([
  "para", "por", "con", "del", "las", "los", "una", "que", "sera", "seran",
  "este", "esta", "estos", "estas", "sus", "sobre", "entre", "cuando", "desde",
  "presente", "ordenanza", "articulo", "articulos", "municipal", "municipio",
  "deberan", "debera", "podra", "podran", "caso", "casos", "efecto", "efectos",
  "conforme", "correspondiente", "correspondientes", "mismo", "misma",
]);

/**
 * Recorte de plural, a lo bruto.
 *
 * Sin esto "ochava" y "ochavas" son términos distintos y el revisor no conecta
 * dos artículos que hablan de lo mismo. No es un stemmer del español —no toca
 * verbos ni géneros— porque para comparar artículos de una ordenanza el plural
 * es el 90% del problema y el resto no paga el riesgo de unir palabras que no
 * van juntas.
 */
function singular(palabra: string): string {
  if (palabra.length > 5 && palabra.endsWith("es")) return palabra.slice(0, -2);
  if (palabra.length > 4 && palabra.endsWith("s")) return palabra.slice(0, -1);
  return palabra;
}

function terminos(texto: string): Set<string> {
  const normalizado = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ");
  const encontrados = new Set<string>();
  for (const palabra of normalizado.split(/\s+/)) {
    if (palabra.length < 4) continue;
    if (RUIDO.has(palabra)) continue;
    encontrados.add(singular(palabra));
  }
  return encontrados;
}

/**
 * Ordena los artículos por parecido con el texto dado y devuelve los primeros.
 *
 * Un término vale más cuanto en menos artículos aparece: "cartel" está en todos
 * y no dice nada; "ochava" en dos y los conecta. Es TF-IDF de bolsillo, sin la
 * parte que no aporta a treinta y tres documentos.
 */
export function articulosRelacionados(
  texto: string,
  candidatos: ArticuloComparable[],
  cuantos = 8,
): ArticuloComparable[] {
  if (candidatos.length === 0) return [];
  const consulta = terminos(texto);
  if (consulta.size === 0) return [];

  const porArticulo = candidatos.map((articulo) => ({
    articulo,
    terminos: terminos(`${articulo.sumilla ?? ""} ${articulo.texto}`),
  }));

  // En cuántos artículos aparece cada término.
  const frecuencia = new Map<string, number>();
  for (const item of porArticulo) {
    // `target: es5` no deja iterar un Set directamente.
    for (const termino of Array.from(item.terminos)) {
      frecuencia.set(termino, (frecuencia.get(termino) ?? 0) + 1);
    }
  }

  const puntuados = porArticulo.map((item) => {
    let puntaje = 0;
    for (const termino of Array.from(consulta)) {
      if (!item.terminos.has(termino)) continue;
      const aparece = frecuencia.get(termino) ?? 1;
      puntaje += 1 / aparece;
    }
    return { articulo: item.articulo, puntaje };
  });

  return puntuados
    .filter((item) => item.puntaje > 0)
    .sort((a, b) => b.puntaje - a.puntaje || a.articulo.numero - b.articulo.numero)
    .slice(0, cuantos)
    .map((item) => item.articulo);
}
