export type DocumentCategory = "Normativa" | "Informe" | "Relevamiento" | "Proceso" | "Nota";

export interface UrbanDocument {
  id: string;
  title: string;
  category: DocumentCategory;
  description: string;
  date: string;
  pdfUrl: string | null;
}

// Los archivos PDF deben ubicarse en public/docs.
export const documents: UrbanDocument[] = [
  { id: "doc-01", title: "Cartelería publicitaria", category: "Informe", description: "Documento general sobre soportes publicitarios y su presencia en el espacio urbano.", date: "2025-02-18", pdfUrl: "/docs/carteleria-publicitaria.pdf" },
  { id: "doc-02", title: "Decreto 0609/18", category: "Normativa", description: "Decreto municipal aplicable a la regulación de la actividad publicitaria.", date: "2018-03-12", pdfUrl: "/docs/decreto-0609-18.pdf" },
  { id: "doc-03", title: "Instalaciones complementarias", category: "Informe", description: "Informe técnico de instalaciones complementarias relevadas en febrero de 2025.", date: "2025-02-28", pdfUrl: "/docs/informe-instalaciones.pdf" },
  { id: "doc-04", title: "Normativa municipal comparada", category: "Normativa", description: "Relevamiento de normativa municipal sobre cartelería en ciudades argentinas.", date: "2025-01-22", pdfUrl: "/docs/normativa-carteleria-argentina.pdf" },
  { id: "doc-05", title: "Informe de decretos y proyectos", category: "Informe", description: "Síntesis administrativa de decretos y proyectos de ordenanza en trámite.", date: "2025-03-10", pdfUrl: "/docs/informe-decretos-proyectos.pdf" },
  { id: "doc-06", title: "Ordenanza N.º 4828/2014", category: "Normativa", description: "Marco regulatorio municipal para el desarrollo de la actividad publicitaria.", date: "2014-11-06", pdfUrl: "/docs/ordenanza-4828-2014.pdf" },
  { id: "doc-07", title: "Procesos de publicidad exterior", category: "Proceso", description: "Circuito de trabajo y etapas vinculadas al control de publicidad exterior.", date: "2025-04-04", pdfUrl: "/docs/procesos-publicidad-exterior.pdf" },
  { id: "doc-08", title: "Nota a Secretaría de Gobierno", category: "Nota", description: "Comunicación administrativa asociada al seguimiento de cartelería urbana.", date: "2025-05-16", pdfUrl: "/docs/nota-secretaria-giuliano.pdf" },
  { id: "doc-09", title: "Nota técnica de arquitectura", category: "Nota", description: "Informe remitido al área técnica sobre condiciones del espacio publicitario.", date: "2025-05-21", pdfUrl: "/docs/nota-arq-lobo-chaklian.pdf" },
  { id: "doc-10", title: "Relevamiento Acosta Muñoz", category: "Relevamiento", description: "Registro documental individual incorporado al operativo FOT 30.", date: "2025-06-02", pdfUrl: "/docs/relevamiento-acosta-munoz.pdf" },
  { id: "doc-11", title: "Relevamiento Calcagni", category: "Relevamiento", description: "Ficha, imágenes y antecedentes del soporte publicitario relevado.", date: "2025-06-03", pdfUrl: "/docs/relevamiento-calcagni.pdf" },
  { id: "doc-12", title: "Relevamiento Central Outdoor", category: "Relevamiento", description: "Documentación consolidada de soportes asociados a Central Outdoor SRL.", date: "2025-06-05", pdfUrl: "/docs/relevamiento-central-outdoor.pdf" },
  { id: "doc-13", title: "Relevamiento Estevez Neme", category: "Relevamiento", description: "Antecedentes y registro visual del relevamiento individual FOT 30.", date: "2025-06-09", pdfUrl: "/docs/relevamiento-estevez-neme.pdf" },
  { id: "doc-14", title: "Relevamiento Gálvez", category: "Relevamiento", description: "Documentación administrativa y fotográfica del cartel identificado.", date: "2025-06-11", pdfUrl: "/docs/relevamiento-galvez.pdf" },
  { id: "doc-15", title: "Relevamiento Giganto Comunicaciones", category: "Relevamiento", description: "Expediente visual asociado a soportes de Giganto Comunicaciones SRL.", date: "2025-06-13", pdfUrl: "/docs/relevamiento-giganto.pdf" }
];
