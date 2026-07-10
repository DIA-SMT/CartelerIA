// ============================================================================
// Fase 5 — Ingesta RAG documental (offline)
// ----------------------------------------------------------------------------
// Extrae texto por página de los PDFs de public/docs, limpia, chunkea, embeda
// (OpenAI text-embedding-3-small) y guarda en Supabase (rag_documentos/chunks).
//
//   Dry-run (sin keys, sin DB):   npx tsx scripts/ingest-docs.ts --dry
//   Ingesta real:                 npx tsx scripts/ingest-docs.ts
//
// Requiere (solo ingesta real) en .env.local:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
// La escritura usa la service-role key (bypassa RLS). Idempotente por hash.
// ============================================================================

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnvConfig } from "@next/env";
import { documents } from "@/data/documents";
import { embedTexts } from "@/lib/embeddings";

const DRY = process.argv.includes("--dry");
const MIN_TEXT_CHARS = 400;    // menos que esto ⇒ PDF escaneado, se saltea
const TARGET_CHARS = 1500;     // tamaño objetivo de chunk
const OVERLAP_CHARS = 200;
const EMBED_BATCH = 96;

interface Chunk {
  pagina: number;
  seccion: string | null;
  contenido: string;
  orden: number;
}

// ----------------------------------------------------------------------------
// Extracción de texto por página (pdfjs-dist, build legacy para Node)
// ----------------------------------------------------------------------------
async function extractPages(filePath: string): Promise<string[]> {
  const require = createRequire(import.meta.url);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")).href;

  const data = new Uint8Array(await readFile(filePath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    pages.push(text);
  }
  return pages;
}

// ----------------------------------------------------------------------------
// Limpieza + chunking con seguimiento de sección (artículo / anexo)
// ----------------------------------------------------------------------------
function clean(text: string): string {
  return text.replace(/­/g, "").replace(/\s+/g, " ").trim();
}

const ARTICULO_RE = /\bart(?:[íi]culo|\.)\s*(\d+\s*(?:bis|ter)?)\s*[°º.\-:]?/i;
const SECCION_RE = /\b(anexo|cap[íi]tulo|t[íi]tulo)\s+([ivxlcdm\d]+)/i;

function detectSection(text: string): string | null {
  const art = text.match(ARTICULO_RE);
  if (art) return `Artículo ${art[1].replace(/\s+/g, " ").trim()}`;
  const sec = text.match(SECCION_RE);
  if (sec) return `${sec[1][0].toUpperCase()}${sec[1].slice(1).toLowerCase()} ${sec[2].toUpperCase()}`;
  return null;
}

function chunkPageText(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + TARGET_CHARS, text.length);
    if (end < text.length) {
      const dot = text.slice(i, end).lastIndexOf(". ");
      if (dot > TARGET_CHARS * 0.5) end = i + dot + 1;
    }
    const piece = text.slice(i, end).trim();
    if (piece.length > 40) out.push(piece);
    if (end >= text.length) break;
    i = Math.max(end - OVERLAP_CHARS, i + 1);
  }
  return out;
}

function buildChunks(pages: string[]): { chunks: Chunk[]; totalChars: number } {
  const chunks: Chunk[] = [];
  let currentSection: string | null = null;
  let totalChars = 0;
  pages.forEach((raw, index) => {
    const cleaned = clean(raw);
    totalChars += cleaned.length;
    for (const piece of chunkPageText(cleaned)) {
      const detected = detectSection(piece);
      if (detected) currentSection = detected;
      chunks.push({ pagina: index + 1, seccion: currentSection, contenido: piece, orden: chunks.length });
    }
  });
  return { chunks, totalChars };
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
  loadEnvConfig(process.cwd());

  const createClient = DRY ? null : (await import("@supabase/supabase-js")).createClient;
  const supabase = DRY ? null : createClient!(reqEnv("NEXT_PUBLIC_SUPABASE_URL"), reqEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

  console.log(`\n${DRY ? "DRY-RUN (sin embeddings ni DB)" : "INGESTA REAL"} — ${documents.length} documentos\n`);
  let ingested = 0, skippedScan = 0, skippedUnchanged = 0, totalChunks = 0;

  for (const doc of documents) {
    if (!doc.pdfUrl) continue;
    const filePath = path.join(process.cwd(), "public", doc.pdfUrl.replace(/^\//, ""));

    let pages: string[];
    try {
      pages = await extractPages(filePath);
    } catch (error) {
      console.log(`✗ ${doc.id} ${doc.title} — error al leer: ${(error as Error).message}`);
      continue;
    }

    const { chunks, totalChars } = buildChunks(pages);
    if (totalChars < MIN_TEXT_CHARS) {
      console.log(`↷ ${doc.id} ${doc.title} — escaneado/sin texto (${totalChars} chars, ${pages.length} pág.) — SALTEADO`);
      skippedScan += 1;
      continue;
    }

    const hash = createHash("sha256").update(chunks.map((c) => c.contenido).join("\n")).digest("hex");
    const sampleSections = Array.from(new Set(chunks.map((c) => c.seccion).filter(Boolean))).slice(0, 4);
    console.log(`✓ ${doc.id} ${doc.title} — ${pages.length} pág., ${chunks.length} chunks${sampleSections.length ? ` · secciones: ${sampleSections.join(", ")}` : ""}`);
    totalChunks += chunks.length;

    if (DRY) {
      console.log(`    muestra: "${chunks[0].contenido.slice(0, 110)}…"`);
      continue;
    }

    // Idempotencia: si el hash no cambió, no re-embeder.
    const { data: existing } = await supabase!.from("rag_documentos").select("contenido_hash").eq("id", doc.id).maybeSingle();
    if (existing?.contenido_hash === hash) {
      console.log(`    sin cambios (hash igual) — omitido`);
      skippedUnchanged += 1;
      continue;
    }

    // Embeddings en batch.
    const embeddings: number[][] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH).map((c) => c.contenido);
      embeddings.push(...(await embedTexts(batch)));
    }

    // Upsert documento + reemplazo de chunks.
    await supabase!.from("rag_documentos").upsert({
      id: doc.id, titulo: doc.title, categoria: doc.category, pdf_url: doc.pdfUrl,
      contenido_hash: hash, paginas: pages.length, chunks: chunks.length,
    });
    await supabase!.from("rag_chunks").delete().eq("documento_id", doc.id);
    const rows = chunks.map((c, i) => ({
      documento_id: doc.id, pagina: c.pagina, seccion: c.seccion,
      contenido: c.contenido, orden: c.orden, embedding: embeddings[i],
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase!.from("rag_chunks").insert(rows.slice(i, i + 200));
      if (error) throw new Error(`insert chunks ${doc.id}: ${error.message}`);
    }
    console.log(`    ingestado (${chunks.length} chunks embebidos)`);
    ingested += 1;
  }

  console.log(`\nResumen: ${DRY ? "(dry-run) " : ""}${ingested} ingestados, ${skippedUnchanged} sin cambios, ${skippedScan} escaneados salteados, ${totalChunks} chunks totales.\n`);
}

function reqEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} en .env.local`);
  return value;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
