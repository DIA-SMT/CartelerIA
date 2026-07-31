export type DocumentCategory = "Normativa" | "Informe" | "Relevamiento" | "Proceso" | "Nota";
export type DocumentAudience = "publico" | "interno";

export interface UrbanDocument {
  id: string;
  title: string;
  category: DocumentCategory;
  description: string;
  date: string;
  audience: DocumentAudience;
  humanReviewed: boolean;
  externalAiAllowed: boolean;
  pdfUrl: string | null;
}

/**
 * Catálogo que puede incorporarse al bundle público. El corpus administrativo
 * interno vive en `internal-documents.ts` y nunca se importa desde componentes.
 */
export const documents: UrbanDocument[] = [
  {
    id: "doc-02",
    title: "Decreto 0609/18",
    category: "Normativa",
    description: "Decreto municipal aplicable a la regulación de la actividad publicitaria.",
    date: "2018-03-12",
    audience: "publico",
    humanReviewed: false,
    externalAiAllowed: false,
    pdfUrl: "/docs/decreto-0609-18.pdf",
  },
  {
    id: "doc-06",
    title: "Ordenanza N.º 4728/2014",
    category: "Normativa",
    description: "Marco regulatorio municipal para el desarrollo de la actividad publicitaria.",
    date: "2014-11-27",
    audience: "publico",
    humanReviewed: false,
    externalAiAllowed: false,
    pdfUrl: "/docs/ordenanza-4728-2014.pdf",
  },
];
