// ============================================================================
// Fase 5 — Ingesta RAG documental (offline)
// ----------------------------------------------------------------------------
// Extrae texto por página de los PDFs públicos e internos, limpia, chunkea,
// genera embeddings locales y guarda en Supabase (rag_documentos/chunks).
//
//   Dry-run (sin keys, sin DB):   npm run ingest:docs:dry
//   Ingesta real:                 npm run ingest:docs
//
// Requiere (solo ingesta real) en .env.local:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// La escritura usa la service-role key (bypassa RLS). Idempotente por hash.
// ============================================================================

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import nextEnv from "@next/env";
import { corpusDocuments } from "../data/document-corpus.ts";
import {
  cortarPorArticulo,
  fragmentarArticulo,
  type CorteArticulado,
} from "../lib/articulado.ts";
import { embedTexts } from "../lib/embeddings.ts";

const DRY = process.argv.includes("--dry");
const { loadEnvConfig } = nextEnv;
const MIN_TEXT_CHARS = 400;    // menos que esto ⇒ PDF escaneado, se saltea
const TARGET_CHARS = 1500;     // tamaño objetivo de chunk
const OVERLAP_CHARS = 200;
const EMBED_BATCH = 96;
const LOW_OCR_CONFIDENCE = 60;
const INGEST_CONTRACT_VERSION = 1;
type IngestDocument = (typeof corpusDocuments)[number];

interface Chunk {
  pagina: number;
  seccion: string | null;
  contenido: string;
  orden: number;
}

// ----------------------------------------------------------------------------
// Extracción de texto por página (pdfjs-dist, build legacy para Node)
// ----------------------------------------------------------------------------
async function extractPages(buffer: Buffer): Promise<string[]> {
  const require = createRequire(import.meta.url);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")).href;

  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
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
// Texto OCR, generado por scripts/ocr-docs.ts. Los documentos públicos usan
// data/ocr; los internos usan private/ocr para no mezclar artefactos sensibles
// con el árbol público. Si el hash no coincide, el OCR se ignora con aviso.
// ----------------------------------------------------------------------------
interface OcrFile {
  sourceHash: string;
  confianzaMedia: number | null;
  dudosa: boolean;
  paginasTotal: number;
  paginas: {
    pagina: number;
    fuente?: "pdf" | "ocr";
    confianza?: number | null;
    texto: string;
  }[];
}

async function loadOcrPages(
  doc: IngestDocument,
  pdfHash: string,
): Promise<{ pages: string[]; confianza: number | null; dudosa: boolean } | null> {
  const ocrRoot = doc.audience === "interno"
    ? path.join("private", "ocr")
    : path.join("data", "ocr");
  const ocrPath = path.join(process.cwd(), ocrRoot, `${doc.id}.json`);
  const displayPath = path.relative(process.cwd(), ocrPath).replaceAll("\\", "/");
  if (!existsSync(ocrPath)) return null;
  try {
    const parsed = JSON.parse(await readFile(ocrPath, "utf8")) as OcrFile;
    if (parsed.sourceHash !== pdfHash) {
      console.log(`  ⚠ ${doc.id}: ${displayPath} quedó desactualizado (el PDF cambió) — re-corré scripts/ocr-docs.ts`);
      return null;
    }
    if (
      !Number.isInteger(parsed.paginasTotal)
      || parsed.paginasTotal <= 0
      || !Array.isArray(parsed.paginas)
      || parsed.paginas.length !== parsed.paginasTotal
    ) {
      console.log(`  ⚠ ${doc.id}: ${displayPath} no contiene un juego completo de páginas — se ignora`);
      return null;
    }
    const ordered = [...parsed.paginas].sort((a, b) => a.pagina - b.pagina);
    if (ordered.some((page, index) => page.pagina !== index + 1)) {
      console.log(`  ⚠ ${doc.id}: ${displayPath} tiene páginas faltantes, repetidas o fuera de orden — se ignora`);
      return null;
    }
    const hasLowConfidencePage = ordered.some((page) =>
      page.fuente === "ocr"
      && (
        typeof page.confianza !== "number"
        || !Number.isFinite(page.confianza)
        || page.confianza < LOW_OCR_CONFIDENCE
      )
    );
    return {
      pages: ordered.map((page) => page.texto ?? ""),
      confianza: parsed.confianzaMedia,
      dudosa: Boolean(parsed.dudosa) || hasLowConfidencePage,
    };
  } catch {
    console.log(`  ⚠ ${doc.id}: ${displayPath} ilegible — se ignora`);
    return null;
  }
}

// ----------------------------------------------------------------------------
// Extracción de párrafos desde .docx
// ----------------------------------------------------------------------------
/**
 * Un `.docx` es un ZIP con `word/document.xml` adentro. Se leen los `<w:p>` y,
 * dentro de cada uno, sus `<w:t>`.
 *
 * Ninguna de las cuatro trampas de pdfjs aplica acá: no hay buffer que se
 * transfiera, no hay build legacy, no aparecen corridas de letras sueltas y no
 * existe el caso del escaneo. El texto de Word es texto, no una reconstrucción.
 *
 * A cambio, la información que sí importa conservar es el salto de párrafo: es
 * lo que permite saber dónde termina el encabezado de un artículo, y es
 * confiable porque lo escribió un editor de texto y no un extractor.
 */
async function extractDocxParagraphs(filePath: string): Promise<string[]> {
  const require = createRequire(import.meta.url);
  const AdmZip = require("adm-zip") as typeof import("adm-zip");
  const zip = new AdmZip(filePath);
  const entry = zip.getEntry("word/document.xml");
  if (!entry) throw new Error("el .docx no contiene word/document.xml");
  const xml = entry.getData().toString("utf8");

  return Array.from(xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g))
    .map((match) => {
      const texto = Array.from(match[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g))
        .map((item) => item[1])
        .join("");
      return texto
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .trim();
    })
    .filter(Boolean);
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

/**
 * Fragmentos a partir del corte por artículo.
 *
 * Cada fragmento conserva el artículo en `seccion`, incluso cuando un artículo
 * largo se parte en varios: la cita sigue siendo el artículo entero. `pagina`
 * queda en 1 porque un `.docx` no tiene paginado que sirva para citar.
 */
function buildChunksDesdeArticulos(corte: CorteArticulado): { chunks: Chunk[]; totalChars: number } {
  const chunks: Chunk[] = [];
  let totalChars = 0;
  for (const articulo of corte.articulos) {
    for (const parte of fragmentarArticulo(articulo, TARGET_CHARS)) {
      totalChars += parte.contenido.length;
      chunks.push({
        pagina: 1,
        seccion: parte.seccion,
        contenido: parte.contenido,
        orden: chunks.length,
      });
    }
  }
  return { chunks, totalChars };
}

function canonicalChunkManifest(chunks: Chunk[]): string {
  return chunks.map((chunk) => {
    const section = chunk.seccion ?? "";
    return [
      chunk.orden,
      chunk.pagina,
      Buffer.byteLength(section, "utf8"),
      section,
      Buffer.byteLength(chunk.contenido, "utf8"),
      chunk.contenido,
    ].join(":");
  }).join("\n");
}

// ----------------------------------------------------------------------------
// Estado legal y siembra: dos actos independientes de la sincronización
// ----------------------------------------------------------------------------
/**
 * Solo lo que estas dos funciones usan del cliente. El cliente real se importa
 * de forma dinámica (el script corre también en dry-run, sin credenciales), así
 * que se describe estructuralmente en vez de arrastrar el tipo completo.
 */
type ClienteIngesta = {
  rpc: (nombre: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

/**
 * Fija el estado legal del documento.
 *
 * Va aparte porque `sincronizar_documento_rag` escribe una lista fija de
 * columnas y no conoce `estado_legal`: recibía el dato en el payload y lo
 * descartaba en silencio. Así el borrador quedó marcado como vigente y el
 * asistente normativo podía citarlo, que es justo lo que había que impedir.
 */
async function fijarEstadoLegal(
  supabase: ClienteIngesta,
  doc: { id: string; estadoLegal?: string },
): Promise<void> {
  const estado = doc.estadoLegal ?? "vigente";
  const { error } = await supabase.rpc("fijar_estado_legal_documento", {
    p_documento_id: doc.id,
    p_estado: estado,
  });
  if (error) {
    throw new Error(`estado legal ${doc.id}: ${error.message}`);
  }
}

/**
 * Siembra el articulado si el documento es el borrador de origen.
 *
 * Se llama en todas las corridas, cambie o no el texto: el articulado no
 * depende de si el borrador se modificó. `sembrar_articulado` ya rechaza un
 * proyecto que tenga artículos, así que repetir la llamada es inofensivo y no
 * pisa trabajo hecho.
 */
async function sembrarSiCorresponde(
  supabase: ClienteIngesta,
  doc: { id: string; title: string; description: string; siembraArticulado?: boolean },
  corte: CorteArticulado | null,
): Promise<void> {
  if (!doc.siembraArticulado) return;
  if (!corte?.estructurado) {
    console.log("    ⚠ articulado NO sembrado: el borrador no tiene estructura de artículos reconocible");
    return;
  }

  // `crear_proyecto_norma` es idempotente: si el borrador ya dio origen a un
  // proyecto, devuelve ese mismo en vez de crear un duplicado.
  const { data: proyectoId, error: proyectoError } = await supabase.rpc("crear_proyecto_norma", {
    p_titulo: doc.title,
    p_objeto: doc.description,
    p_documento_origen_id: doc.id,
  });
  if (proyectoError || typeof proyectoId !== "string") {
    throw new Error(`alta del proyecto ${doc.id}: ${proyectoError?.message ?? "respuesta inválida"}`);
  }

  const articulos = corte.articulos.map((articulo) => ({
    numero: articulo.numero,
    sumilla: articulo.sumilla,
    texto: articulo.texto,
  }));
  const { data: sembrados, error: siembraError } = await supabase.rpc("sembrar_articulado", {
    p_proyecto_id: proyectoId,
    p_articulos: articulos,
  });
  if (siembraError) {
    // Falla a propósito si el proyecto ya tiene artículos: no pisa trabajo
    // hecho. Se avisa con claridad en vez de dejarlo pasar.
    console.log(`    · articulado ya sembrado, no se toca (${siembraError.message})`);
    return;
  }
  console.log(`    articulado sembrado: ${sembrados} artículos en estado propuesto`);
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
  loadEnvConfig(process.cwd());

  const createClient = DRY ? null : (await import("@supabase/supabase-js")).createClient;
  const supabase = DRY ? null : createClient!(reqEnv("NEXT_PUBLIC_SUPABASE_URL"), reqEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

  console.log(`\n${DRY ? "DRY-RUN (sin embeddings ni DB)" : "INGESTA REAL"} — ${corpusDocuments.length} documentos\n`);
  let ingested = 0, skippedScan = 0, skippedUnchanged = 0, totalChunks = 0;

  for (const doc of corpusDocuments) {
    const filePath = path.join(process.cwd(), doc.sourcePath);

    const esDocx = doc.sourcePath.toLowerCase().endsWith(".docx");
    let pages: string[];
    let parrafos: string[] = [];
    let sourcePdfHash = "";
    let ocrInfo: { confianza: number | null; dudosa: boolean } | null = null;
    try {
      const buffer = await readFile(filePath);
      sourcePdfHash = createHash("sha256").update(buffer).digest("hex");
      if (esDocx) {
        parrafos = await extractDocxParagraphs(filePath);
        // El .docx no tiene paginado util: se trata como una sola pagina y la
        // unidad de cita pasa a ser el articulo, que es lo que corresponde.
        pages = [parrafos.join("\n")];
      } else {
        const ocr = await loadOcrPages(doc, sourcePdfHash);
        if (ocr) {
          pages = ocr.pages;
          ocrInfo = { confianza: ocr.confianza, dudosa: ocr.dudosa };
        } else {
          pages = await extractPages(buffer);
        }
      }
    } catch (error) {
      console.log(`✗ ${doc.id} ${doc.title} — error al leer: ${(error as Error).message}`);
      continue;
    }

    // Un texto normativo se corta por articulo, no por ventana de caracteres:
    // la unidad de cita de una ordenanza es el articulo y `seccion` pesa A en
    // el indice lexico. Si no hay estructura reconocible, se cae al corte por
    // ventanas y NO se siembra articulado.
    let corte: CorteArticulado | null = null;
    if (esDocx) {
      corte = cortarPorArticulo(parrafos);
      for (const aviso of corte.avisos) console.log(`  ⚠ ${doc.id}: ${aviso}`);
      if (!corte.estructurado) {
        console.log(`  ⚠ ${doc.id}: sin estructura de artículos — se indexa por ventanas y no se siembra articulado`);
      }
    }

    const { chunks, totalChars } = corte?.estructurado
      ? buildChunksDesdeArticulos(corte)
      : buildChunks(pages);
    if (totalChars < MIN_TEXT_CHARS) {
      console.log(`↷ ${doc.id} ${doc.title} — escaneado/sin texto (${totalChars} chars, ${pages.length} pág.) — SALTEADO (corré scripts/ocr-docs.ts)`);
      skippedScan += 1;
      continue;
    }

    const contentHash = createHash("sha256")
      .update(canonicalChunkManifest(chunks), "utf8")
      .digest("hex");
    const ocrConfidence = ocrInfo?.confianza != null
      && Number.isFinite(ocrInfo.confianza)
      && ocrInfo.confianza >= 0
      && ocrInfo.confianza <= 100
      ? ocrInfo.confianza
      : null;
    const ocrDoubtful = ocrInfo !== null
      ? ocrInfo.dudosa || ocrConfidence === null
      : false;
    if (
      doc.externalAiAllowed
      && (
        doc.audience !== "publico"
        || !doc.humanReviewed
        || ocrDoubtful
      )
    ) {
      throw new Error(
        `${doc.id}: externalAiAllowed exige documento público, revisión humana y OCR no dudoso`,
      );
    }
    const documentPayload = {
      id: doc.id,
      titulo: doc.title,
      categoria: doc.category,
      pdf_url: doc.pdfUrl ?? `private:${doc.id}`,
      contenido_hash: contentHash,
      source_pdf_hash: sourcePdfHash,
      paginas: pages.length,
      chunks: chunks.length,
      ingest_contract_version: INGEST_CONTRACT_VERSION,
      audience: doc.audience,
      ocr_confidence: ocrConfidence,
      ocr_doubtful: ocrDoubtful,
      // Sin estado declarado, el documento es normativa vigente: es lo que
      // corresponde a todo el corpus anterior al proyecto de ordenanza.
      estado_legal: doc.estadoLegal ?? "vigente",
    };
    const sampleSections = Array.from(new Set(chunks.map((c) => c.seccion).filter(Boolean))).slice(0, 4);
    const ocrTag = ocrInfo ? ` · OCR ${ocrInfo.confianza ?? "?"}%${ocrInfo.dudosa ? " ⚠ dudoso" : ""}` : "";
    const governanceTag = ` · ${doc.audience} · revisado=${doc.humanReviewed ? "sí" : "no"} · IA externa=${doc.externalAiAllowed ? "sí" : "no"}`;
    console.log(`✓ ${doc.id} ${doc.title} — ${pages.length} pág., ${chunks.length} chunks${ocrTag}${governanceTag}${sampleSections.length ? ` · secciones: ${sampleSections.join(", ")}` : ""}`);
    totalChunks += chunks.length;

    if (DRY) {
      console.log(
        doc.audience === "publico"
          ? `    muestra: "${chunks[0].contenido.slice(0, 110)}…"`
          : "    muestra interna omitida del log",
      );
      continue;
    }

    // Idempotencia: además de los hashes se comprueba el conteo real de chunks.
    // Así una corrida interrumpida de una versión anterior no queda "sana" solo
    // porque el catálogo ya haya guardado el hash nuevo.
    const { data: existing, error: existingError } = await supabase!
      .from("rag_documentos")
      .select("contenido_hash, source_pdf_hash, ingest_contract_version")
      .eq("id", doc.id)
      .maybeSingle();
    if (existingError) {
      throw new Error(`consulta rag_documentos ${doc.id}: ${existingError.message}`);
    }
    let actualChunkCount = 0;
    if (existing) {
      const { count, error: countError } = await supabase!
        .from("rag_chunks")
        .select("id", { count: "exact", head: true })
        .eq("documento_id", doc.id);
      if (countError) {
        throw new Error(`conteo rag_chunks ${doc.id}: ${countError.message}`);
      }
      actualChunkCount = count ?? 0;
    }
    const versionUnchanged = Boolean(
      existing
      && existing.contenido_hash === contentHash
      && existing.source_pdf_hash === sourcePdfHash
      && existing.ingest_contract_version === INGEST_CONTRACT_VERSION
      && actualChunkCount === chunks.length,
    );
    if (versionUnchanged) {
      const { data: synchronized, error: metadataError } = await supabase!
        .rpc("sincronizar_documento_rag", {
          p_documento: documentPayload,
          p_chunks: null,
        });
      if (metadataError || synchronized !== true) {
        throw new Error(
          `metadata rag_documentos ${doc.id}: ${metadataError?.message ?? "respuesta inválida"}`,
        );
      }
      await fijarEstadoLegal(supabase!, doc);
      console.log(`    sin cambios (PDF, texto y chunks) — metadata sincronizada`);
      skippedUnchanged += 1;
      // La siembra NO va dentro del camino de ingesta: el articulado no depende
      // de si el texto del borrador cambió. Acoplarlos hacía que un documento
      // "sin cambios" saltara la siembra para siempre.
      await sembrarSiCorresponde(supabase!, doc, corte);
      continue;
    }

    // Embeddings en batch.
    const embeddings: number[][] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH).map((c) => c.contenido);
      embeddings.push(...(await embedTexts(batch)));
    }

    const rows = chunks.map((c, i) => ({
      pagina: c.pagina, seccion: c.seccion,
      contenido: c.contenido, orden: c.orden, embedding: embeddings[i],
    }));
    const { data: synchronized, error: syncError } = await supabase!
      .rpc("sincronizar_documento_rag", {
        p_documento: documentPayload,
        p_chunks: rows,
      });
    if (syncError || synchronized !== true) {
      const diagnostic = syncError
        ? [syncError.code, syncError.message, syncError.details, syncError.hint]
            .filter(Boolean)
            .join(" | ")
        : "respuesta inválida";
      throw new Error(
        `sincronización atómica ${doc.id}: ${diagnostic}`,
      );
    }
    await fijarEstadoLegal(supabase!, doc);
    console.log(`    ingestado atómicamente (${chunks.length} chunks embebidos)`);
    ingested += 1;
    await sembrarSiCorresponde(supabase!, doc, corte);
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
