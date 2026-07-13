// ============================================================================
// Fase 5 — OCR del corpus escaneado (offline, opción A: tesseract.js)
// ----------------------------------------------------------------------------
// Aplica OCR (español) SOLO a las páginas escaneadas (imagen) de los PDFs de
// public/docs, dejando el texto listo para el chunking/embeddings del RAG.
//
//   npx tsx scripts/ocr-docs.ts            # procesa lo pendiente (idempotente)
//   npx tsx scripts/ocr-docs.ts --force    # reprocesa todo
//   npx tsx scripts/ocr-docs.ts doc-06     # procesa solo ese/esos docId
//
// - Preserva los PDF originales intactos (nunca escribe en public/docs).
// - Salida: data/ocr/<docId>.json  { paginas:[{ pagina, fuente, confianza, texto }] }.
// - Idempotente: saltea digitales y lo ya procesado (hash del PDF sin cambios).
// - Páginas que YA tienen texto se copian del PDF (fuente "pdf"); las imagen se
//   renderizan (pdfjs@6 + @napi-rs/canvas) y se OCR-ean (fuente "ocr"),
//   conservando el número de página para poder citar y "Ver en el documento".
// ============================================================================

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { documents } from "@/data/documents";

const ROOT = process.cwd();
const DOCS_DIR = path.join(ROOT, "public", "docs");
const OUT_DIR = path.join(ROOT, "data", "ocr");
const CACHE_DIR = path.join(ROOT, "node_modules", ".cache", "tesseract");

const RENDER_SCALE = 2;     // ~2800px en el lado largo: buen OCR sin PNGs enormes
const PAGE_TEXT_MIN = 80;   // una página con >= 80 chars limpios ⇒ ya tiene texto
const LOW_CONF = 60;        // confianza media por debajo ⇒ se marca como dudosa

const FORCE = process.argv.includes("--force");
const ONLY = process.argv.filter((a) => /^doc-\d+$/.test(a));

interface PageOut {
  pagina: number;
  fuente: "pdf" | "ocr";
  confianza: number | null; // 0-100 (tesseract) o null si vino del PDF
  chars: number;
  texto: string;
}

const clean = (t: string) => t.replace(/­/g, "").replace(/\s+/g, " ").trim();

// CanvasFactory para Node (patrón del ejemplo oficial pdfjs/node).
class NodeCanvasFactory {
  create(w: number, h: number) {
    const canvas = createCanvas(Math.ceil(w), Math.ceil(h));
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(cc: { canvas: ReturnType<typeof createCanvas> }, w: number, h: number) {
    cc.canvas.width = Math.ceil(w);
    cc.canvas.height = Math.ceil(h);
  }
  destroy(cc: { canvas: ReturnType<typeof createCanvas> }) {
    cc.canvas.width = 0;
    cc.canvas.height = 0;
  }
}

// pdfjs@6 del proyecto (misma versión que el visor / la ingesta). Sin worker:
// en Node usa el interno. Una sola versión ⇒ sin choque de workers.
async function openPdf(buf: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(buf);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pdfjs.getDocument({ data, useSystemFonts: true, canvasFactory: new NodeCanvasFactory() } as any).promise;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function renderPagePng(page: any): Promise<Buffer> {
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const factory = new NodeCanvasFactory();
  const cc = factory.create(viewport.width, viewport.height);
  await page.render({ canvasContext: cc.context, viewport, canvasFactory: factory }).promise;
  return cc.canvas.toBuffer("image/png");
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });

  const targets = documents.filter((d) => d.pdfUrl && (ONLY.length === 0 || ONLY.includes(d.id)));

  const { createWorker } = await import("tesseract.js");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let worker: any = null;
  const getWorker = async () => {
    if (!worker) {
      console.log("· Inicializando tesseract.js (spa) — la 1ª vez descarga el modelo…");
      worker = await createWorker("spa", 1, { cachePath: CACHE_DIR });
    }
    return worker;
  };

  let procesados = 0;
  let salteados = 0;

  for (const doc of targets) {
    const file = path.basename(doc.pdfUrl as string);
    const filePath = path.join(DOCS_DIR, file);
    if (!existsSync(filePath)) { console.log(`✗ ${doc.id} ${file}: no existe`); continue; }

    const buf = await readFile(filePath);
    const sourceHash = createHash("sha256").update(buf).digest("hex");
    const outPath = path.join(OUT_DIR, `${doc.id}.json`);

    if (!FORCE && existsSync(outPath)) {
      try {
        const prev = JSON.parse(await readFile(outPath, "utf8")) as { sourceHash?: string };
        if (prev.sourceHash === sourceHash) { console.log(`↷ ${doc.id} ${file}: ya procesado (sin cambios)`); salteados += 1; continue; }
      } catch { /* json inválido: reprocesar */ }
    }

    const pdf = await openPdf(buf);
    const numPages: number = pdf.numPages;

    // 1ª pasada: texto nativo por página para decidir qué OCR-ear.
    const pdfText: string[] = [];
    for (let n = 1; n <= numPages; n += 1) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pdfText.push(clean(content.items.map((it: any) => (it && typeof it === "object" && "str" in it ? String(it.str) : "")).join(" ")));
    }
    const imagePages = pdfText.filter((t) => t.length < PAGE_TEXT_MIN).length;
    if (imagePages === 0) { console.log(`○ ${doc.id} ${file}: digital (${numPages} págs con texto) — sin OCR`); salteados += 1; continue; }

    console.log(`▶ ${doc.id} ${file}: ${numPages} págs, ${imagePages} a OCR-ear…`);
    const w = await getWorker();

    const pages: PageOut[] = [];
    const confs: number[] = [];
    for (let n = 1; n <= numPages; n += 1) {
      const existing = pdfText[n - 1] ?? "";
      if (existing.length >= PAGE_TEXT_MIN) {
        pages.push({ pagina: n, fuente: "pdf", confianza: null, chars: existing.length, texto: existing });
        process.stdout.write(`   p${n} pdf ✓  `);
        continue;
      }
      const page = await pdf.getPage(n);
      const png = await renderPagePng(page);
      const { data } = await w.recognize(png);
      const texto = clean(data.text || "");
      const confianza = Math.round((data.confidence ?? 0) * 10) / 10;
      confs.push(confianza);
      pages.push({ pagina: n, fuente: "ocr", confianza, chars: texto.length, texto });
      process.stdout.write(`   p${n} ocr ${confianza}%${confianza < LOW_CONF ? "⚠" : ""} ${texto.length}c  `);
    }
    process.stdout.write("\n");

    const confianzaMedia = confs.length ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 10) / 10 : null;
    const out = {
      docId: doc.id,
      titulo: doc.title,
      archivo: file,
      sourceHash,
      ocrAplicado: true,
      fecha: new Date().toISOString(),
      modelo: "tesseract.js spa",
      escala: RENDER_SCALE,
      paginasTotal: pages.length,
      paginasOcr: confs.length,
      confianzaMedia,
      dudosa: confianzaMedia != null && confianzaMedia < LOW_CONF,
      paginas: pages,
    };
    await writeFile(outPath, JSON.stringify(out, null, 2), "utf8");
    procesados += 1;
    console.log(`  ✔ ${doc.id}: conf. media ${confianzaMedia}%${out.dudosa ? " ⚠ DUDOSA" : ""} → data/ocr/${doc.id}.json`);
  }

  if (worker) await worker.terminate();
  console.log(`\nListo. Procesados: ${procesados} · Salteados (digital/sin cambios): ${salteados}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
