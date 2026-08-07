import type { ArticuloNorma } from "./fabrica-repository";

/**
 * Ensamblado del documento normativo.
 *
 * Vive separado de la pantalla para poder probarlo: la numeración de un
 * documento que se eleva no debería depender de haber abierto un modal.
 *
 * Una sola salida, PDF, desde la vista para imprimir. El Word y el Excel se
 * sacaron: eran dos formatos más para mantener y una decisión más para tomar
 * cada vez.
 */

export interface ArticuloEnsamblado {
  /** Numeración recalculada al ensamblar. El `orden` es lo que manda. */
  numero: number;
  sumilla: string | null;
  texto: string;
  articuloId: string;
}

/**
 * Ordena y renumera.
 *
 * Los artículos quitados del documento quedan afuera pero no se borran de la
 * base: siguen siendo el antecedente de por qué algo no está, y volver a
 * incluirlos es un clic.
 */
export function ensamblarArticulado(articulos: ArticuloNorma[]): ArticuloEnsamblado[] {
  return articulos
    .filter((articulo) => articulo.estado !== "descartado")
    .slice()
    .sort((a, b) => a.orden - b.orden)
    .map((articulo, indice) => ({
      numero: indice + 1,
      sumilla: articulo.sumilla,
      texto: articulo.texto,
      articuloId: articulo.id,
    }));
}

/**
 * Nombre del archivo.
 *
 * El PDF lo nombra el navegador a partir de `document.title`. Un archivo
 * "CartelerIA.pdf" en la carpeta de alguien no dice qué es.
 */
export function nombreDocumento(): string {
  return `ordenanza-${new Date().toISOString().slice(0, 10)}`;
}

/** Pie del documento. Decir cómo se hizo es más defendible que no decirlo. */
export function pieDelDocumento(proyecto: string): string {
  const fecha = new Date().toLocaleDateString("es-AR");
  return [
    `${proyecto} · ${fecha}`,
    "Texto redactado con asistencia de herramientas automáticas y revisión humana municipal.",
    "Documento de trabajo institucional. No reemplaza el acto administrativo ni la revisión jurídica aplicable.",
  ].join("\n");
}
