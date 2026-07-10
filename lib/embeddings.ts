// ============================================================================
// Embeddings — LOCALES (Transformers.js). Sin cuentas, sin API keys, sin costo.
// Corren en el server/máquina; el modelo se descarga una vez y queda cacheado.
// Modelo multilingüe (bueno en español), 384 dimensiones. Se usa en la ingesta
// (scripts/ingest-docs.ts) y en la consulta (app/api/normativa/route.ts).
// ============================================================================

import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

export const EMBEDDING_DIM = 384;
const MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL);
  }
  return extractorPromise;
}

/** Embebe un lote de textos. Devuelve un array de vectores (384 dims c/u). */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return output.tolist() as number[][];
}

/** Embebe un único texto (para la consulta). */
export async function embedText(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  return vector;
}
