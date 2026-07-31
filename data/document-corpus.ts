import { documents } from "./documents.ts";
import {
  internalDocuments,
  type CorpusDocument,
} from "./internal-documents.ts";

const publicCorpusDocuments: CorpusDocument[] = documents.flatMap((document) =>
  document.pdfUrl
    ? [{ ...document, sourcePath: `public${document.pdfUrl}` }]
    : []
);

/** Catálogo completo, exclusivo de procesos offline y rutas server-side. */
export const corpusDocuments: CorpusDocument[] = [
  ...publicCorpusDocuments,
  ...internalDocuments,
];
