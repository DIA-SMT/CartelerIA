import type { UrbanDocument } from "./documents.ts";

export type CorpusDocument = UrbanDocument & {
  sourcePath: string;
};

/**
 * Catálogo interno. Estos paths son fuentes offline/server-side y no son URLs
 * públicas. Ningún componente cliente debe importar este módulo.
 */
export const internalDocuments: CorpusDocument[] = [
  { id: "doc-01", title: "Cartelería publicitaria", category: "Informe", description: "Documento general sobre soportes publicitarios y su presencia en el espacio urbano.", date: "2025-02-18", audience: "interno", humanReviewed: false, externalAiAllowed: false, pdfUrl: null, sourcePath: "private/docs/carteleria-publicitaria.pdf" },
  { id: "doc-03", title: "Instalaciones complementarias", category: "Informe", description: "Informe técnico de instalaciones complementarias relevadas en febrero de 2025.", date: "2025-02-28", audience: "interno", humanReviewed: false, externalAiAllowed: false, pdfUrl: null, sourcePath: "private/docs/informe-instalaciones.pdf" },
  { id: "doc-04", title: "Normativa municipal comparada", category: "Normativa", description: "Relevamiento interno de normativa municipal sobre cartelería en ciudades argentinas.", date: "2025-01-22", audience: "interno", humanReviewed: false, externalAiAllowed: false, pdfUrl: null, sourcePath: "private/docs/normativa-carteleria-argentina.pdf" },
  { id: "doc-05", title: "Informe de decretos y proyectos", category: "Informe", description: "Síntesis administrativa de decretos y proyectos de ordenanza en trámite.", date: "2025-03-10", audience: "interno", humanReviewed: false, externalAiAllowed: false, pdfUrl: null, sourcePath: "private/docs/informe-decretos-proyectos.pdf" },
  { id: "doc-07", title: "Procesos de publicidad exterior", category: "Proceso", description: "Circuito interno de trabajo y etapas vinculadas al control de publicidad exterior.", date: "2025-04-04", audience: "interno", humanReviewed: false, externalAiAllowed: false, pdfUrl: null, sourcePath: "private/docs/procesos-publicidad-exterior.pdf" },
  { id: "doc-08", title: "Nota a Secretaría de Gobierno", category: "Nota", description: "Comunicación administrativa asociada al seguimiento de cartelería urbana.", date: "2025-05-16", audience: "interno", humanReviewed: false, externalAiAllowed: false, pdfUrl: null, sourcePath: "private/docs/nota-secretaria-giuliano.pdf" },
  { id: "doc-09", title: "Nota técnica de arquitectura", category: "Nota", description: "Informe remitido al área técnica sobre condiciones del espacio publicitario.", date: "2025-05-21", audience: "interno", humanReviewed: false, externalAiAllowed: false, pdfUrl: null, sourcePath: "private/docs/nota-arq-lobo-chaklian.pdf" },
  { id: "doc-10", title: "Relevamiento Acosta Muñoz", category: "Relevamiento", description: "Registro documental individual incorporado al operativo FOT 30.", date: "2025-06-02", audience: "interno", humanReviewed: false, externalAiAllowed: false, pdfUrl: null, sourcePath: "private/docs/relevamiento-acosta-munoz.pdf" },
  { id: "doc-11", title: "Relevamiento Calcagni", category: "Relevamiento", description: "Ficha, imágenes y antecedentes del soporte publicitario relevado.", date: "2025-06-03", audience: "interno", humanReviewed: false, externalAiAllowed: false, pdfUrl: null, sourcePath: "private/docs/relevamiento-calcagni.pdf" },
  { id: "doc-12", title: "Relevamiento Central Outdoor", category: "Relevamiento", description: "Documentación consolidada de soportes asociados a Central Outdoor SRL.", date: "2025-06-05", audience: "interno", humanReviewed: false, externalAiAllowed: false, pdfUrl: null, sourcePath: "private/docs/relevamiento-central-outdoor.pdf" },
  { id: "doc-13", title: "Relevamiento Estevez Neme", category: "Relevamiento", description: "Antecedentes y registro visual del relevamiento individual FOT 30.", date: "2025-06-09", audience: "interno", humanReviewed: false, externalAiAllowed: false, pdfUrl: null, sourcePath: "private/docs/relevamiento-estevez-neme.pdf" },
  { id: "doc-14", title: "Relevamiento Gálvez", category: "Relevamiento", description: "Documentación administrativa y fotográfica del cartel identificado.", date: "2025-06-11", audience: "interno", humanReviewed: false, externalAiAllowed: false, pdfUrl: null, sourcePath: "private/docs/relevamiento-galvez.pdf" },
  { id: "doc-15", title: "Relevamiento Giganto Comunicaciones", category: "Relevamiento", description: "Expediente visual asociado a soportes de Giganto Comunicaciones SRL.", date: "2025-06-13", audience: "interno", humanReviewed: false, externalAiAllowed: false, pdfUrl: null, sourcePath: "private/docs/relevamiento-giganto.pdf" },
];
