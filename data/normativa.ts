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
}

export interface NormativaResponse {
  refused: boolean;
  answer: string | null;
  citations: NormativaCitation[];
  note?: "sin_llm" | "llm_error";
}
