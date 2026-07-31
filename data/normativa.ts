// Tipos compartidos entre la API /api/normativa (server) y la UI (cliente).
// Módulo neutro (sin dependencias de server) para poder importarlo en ambos.

export interface NormativaCitation {
  n: number;
  documentoId: string;
  titulo: string;
  pdfUrl: string | null;
  pagina: number | null;
  seccion: string | null;
  fragmento: string;
  similarity: number;
  contenidoHash: string | null;
  sourcePdfHash: string | null;
  audience: "publico" | "interno";
  humanReviewed: boolean;
  ocrDoubtful: boolean;
  legalUseReady: boolean;
}

export interface NormativaResponse {
  refused: boolean;
  answer: string | null;
  citations: NormativaCitation[];
  note?:
    | "sin_llm"
    | "ia_externa_desactivada"
    | "fuente_restringida"
    | "pii_detectada"
    | "llm_error"
    | "llm_refused"
    | "citas_invalidas"
    | "revision_humana_requerida";
}
