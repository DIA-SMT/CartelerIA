import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const EXPECTED_RAG_DOCUMENTS = 15;
const EXPECTED_RAG_CHUNKS = 192;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const EXPECTED_LEGAL_DOCUMENTS = {
  "doc-02": {
    title: "Decreto 0609/18",
    pdfUrl: "/docs/decreto-0609-18.pdf",
  },
  "doc-06": {
    title: "Ordenanza N.º 4728/2014",
    pdfUrl: "/docs/ordenanza-4728-2014.pdf",
  },
};
const LEXICAL_PROBES = [
  { query: "¿Qué problemas genera la cartelería sin control?" },
  { query: "¿Qué proponen para ordenar la cartelería?" },
  { query: "¿Qué son los corredores publicitarios?" },
  { query: "Ordenanza 4728/2014", expectedDocumentId: "doc-06" },
  { query: "Decreto 0609-18", expectedDocumentId: "doc-02" },
];

function parseEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function loadConfiguration() {
  let local = {};
  try {
    local = parseEnv(await readFile(new URL("../.env.local", import.meta.url), "utf8"));
  } catch {
    // También admite variables inyectadas por CI.
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || local.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || local.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. No se realizó ninguna consulta.",
    );
  }
  return { url, serviceRoleKey };
}

async function exactCount(client, table, configure = (query) => query) {
  const query = configure(
    client.from(table).select("id", { count: "exact", head: true }),
  );
  const { count, error } = await query;
  if (error) return { ok: false, count: null, error: error.code || error.message };
  return { ok: true, count: count ?? 0, error: null };
}

const { url, serviceRoleKey } = await loadConfiguration();
const client = createClient(url, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

const lexicalRetrievalPromise = Promise.all(
  LEXICAL_PROBES.map(async (probe) => {
    const result = await client.rpc("buscar_rag_chunks_lexico", {
      p_query: probe.query,
      p_match_count: 8,
    });
    const rows = Array.isArray(result.data) ? result.data : [];
    const documentIds = [
      ...new Set(
        rows
          .map((row) => row?.documento_id)
          .filter((id) => typeof id === "string"),
      ),
    ];
    return {
      query: probe.query,
      expectedDocumentId: probe.expectedDocumentId ?? null,
      count: result.error ? null : rows.length,
      documentIds,
      error: result.error?.code || result.error?.message || null,
      healthy:
        !result.error
        && rows.length > 0
        && rows.length <= 8
        && (
          !probe.expectedDocumentId
          || documentIds.includes(probe.expectedDocumentId)
        ),
    };
  }),
);

const [
  cartelesResult,
  inspections,
  expedientes,
  requests,
  audits,
  photoColumns,
  documentColumns,
  photoPaths,
  documentPaths,
  ragDocuments,
  ragChunks,
  inspectionPhotoBucket,
  expedienteDocumentBucket,
  keepaliveRpc,
  lexicalRetrievalProbes,
] = await Promise.all([
  client
    .from("carteles")
    .select(
      "id, vinculo_estado, territorial_feature_id, territorial_feature_id_propuesto, vinculo_solicitado_por, vinculo_solicitado_en, vinculo_aprobado_por, vinculo_aprobado_en",
    ),
  exactCount(client, "inspecciones"),
  exactCount(client, "expedientes"),
  exactCount(client, "cambio_estado_solicitudes"),
  exactCount(client, "auditoria_eventos"),
  client
    .from("inspeccion_fotos")
    .select("id, sha256, byte_size, mime_type, created_by")
    .limit(1),
  client
    .from("expediente_documentos")
    .select("id, sha256, byte_size, mime_type, created_by")
    .limit(1),
  client.from("inspeccion_fotos").select("id, storage_path"),
  client.from("expediente_documentos").select("id, storage_path"),
  client.from("rag_documentos").select(
    "id, titulo, pdf_url, contenido_hash, source_pdf_hash, ingest_contract_version, paginas, chunks, audience, human_reviewed, external_ai_allowed, ocr_confidence, ocr_doubtful",
  ),
  client.from("rag_chunks").select("id, documento_id"),
  client.storage.getBucket("inspeccion-fotos"),
  client.storage.getBucket("expediente-docs"),
  client.rpc("keepalive_ping"),
  lexicalRetrievalPromise,
]);

if (cartelesResult.error || !cartelesResult.data) {
  throw new Error(
    `No se pudo leer el estado de carteles: ${
      cartelesResult.error?.code
      || cartelesResult.error?.message
      || cartelesResult.statusText
      || `HTTP ${cartelesResult.status}`
    }`,
  );
}

const linkCounts = {
  aprobado: 0,
  pendiente: 0,
  rechazado: 0,
  sin_vinculo: 0,
  invalido: 0,
};
let approvedWithoutTrace = 0;
let invalidLinkRowsAfterRatification = 0;
const reservedFeatureCounts = new Map();
for (const row of cartelesResult.data) {
  if (row.vinculo_estado in linkCounts) {
    linkCounts[row.vinculo_estado] += 1;
  } else {
    linkCounts.invalido += 1;
  }
  if (
    row.vinculo_estado === "aprobado"
    && (!row.territorial_feature_id
      || row.territorial_feature_id_propuesto
      || !row.vinculo_aprobado_por
      || !row.vinculo_aprobado_en)
  ) {
    approvedWithoutTrace += 1;
  }

  const requiresRatification =
    row.vinculo_estado === "aprobado"
    && Boolean(row.territorial_feature_id)
    && !row.vinculo_aprobado_por;
  const projected = requiresRatification
    ? {
        ...row,
        territorial_feature_id_propuesto: row.territorial_feature_id,
        territorial_feature_id: null,
        vinculo_estado: "pendiente",
        vinculo_solicitado_por: null,
        vinculo_solicitado_en: "migration-now",
        vinculo_aprobado_por: null,
        vinculo_aprobado_en: null,
      }
    : row;
  const valid = (() => {
    if (projected.vinculo_estado === "sin_vinculo") {
      return !projected.territorial_feature_id
        && !projected.territorial_feature_id_propuesto
        && !projected.vinculo_solicitado_por
        && !projected.vinculo_solicitado_en
        && !projected.vinculo_aprobado_por
        && !projected.vinculo_aprobado_en;
    }
    if (projected.vinculo_estado === "pendiente") {
      return !projected.territorial_feature_id
        && Boolean(projected.territorial_feature_id_propuesto?.trim())
        && Boolean(projected.vinculo_solicitado_en)
        && !projected.vinculo_aprobado_por
        && !projected.vinculo_aprobado_en;
    }
    if (projected.vinculo_estado === "aprobado") {
      return Boolean(projected.territorial_feature_id?.trim())
        && !projected.territorial_feature_id_propuesto
        && Boolean(projected.vinculo_aprobado_por)
        && Boolean(projected.vinculo_aprobado_en);
    }
    if (projected.vinculo_estado === "rechazado") {
      return !projected.territorial_feature_id
        && Boolean(projected.territorial_feature_id_propuesto?.trim())
        && Boolean(projected.vinculo_solicitado_en)
        && !projected.vinculo_aprobado_por
        && !projected.vinculo_aprobado_en;
    }
    return false;
  })();
  if (!valid) invalidLinkRowsAfterRatification += 1;

  if (
    projected.vinculo_estado === "aprobado"
    || projected.vinculo_estado === "pendiente"
  ) {
    const feature = (
      projected.territorial_feature_id
      || projected.territorial_feature_id_propuesto
      || ""
    ).trim();
    if (feature) {
      reservedFeatureCounts.set(
        feature,
        (reservedFeatureCounts.get(feature) ?? 0) + 1,
      );
    }
  }
}
const duplicateReservedFeatures = [...reservedFeatureCounts.values()]
  .filter((count) => count > 1)
  .length;
function duplicatePathCount(result) {
  if (result.error || !Array.isArray(result.data)) return null;
  const counts = new Map();
  for (const row of result.data) {
    const path = typeof row.storage_path === "string" ? row.storage_path : "";
    if (!path) continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return [...counts.values()].filter((count) => count > 1).length;
}
const duplicateInspectionPhotoPaths = duplicatePathCount(photoPaths);
const duplicateExpedienteDocumentPaths = duplicatePathCount(documentPaths);

const ragDocumentRows = Array.isArray(ragDocuments.data) ? ragDocuments.data : [];
const ragChunkRows = Array.isArray(ragChunks.data) ? ragChunks.data : [];
const actualChunksByDocument = new Map();
for (const row of ragChunkRows) {
  actualChunksByDocument.set(
    row.documento_id,
    (actualChunksByDocument.get(row.documento_id) ?? 0) + 1,
  );
}
const ragDeclaredChunks = ragDocumentRows.reduce(
  (total, row) => total + (Number.isInteger(row.chunks) ? row.chunks : 0),
  0,
);
const ragChunkCountMismatches = ragDocumentRows.filter(
  (row) => actualChunksByDocument.get(row.id) !== row.chunks,
).length;
const ragOrphanDocumentIds = new Set(
  ragChunkRows
    .map((row) => row.documento_id)
    .filter((id) => !ragDocumentRows.some((document) => document.id === id)),
).size;
const ragInvalidHashes = ragDocumentRows.filter(
  (row) => !SHA256_PATTERN.test(row.contenido_hash ?? "")
    || !SHA256_PATTERN.test(row.source_pdf_hash ?? ""),
).length;
const ragLegacyContracts = ragDocumentRows.filter(
  (row) => row.ingest_contract_version !== 1,
).length;
const ragInvalidPageCounts = ragDocumentRows.filter(
  (row) => !Number.isInteger(row.paginas) || row.paginas <= 0,
).length;
const ragHumanReviewed = ragDocumentRows.filter((row) => row.human_reviewed).length;
const ragExternalAiAllowed = ragDocumentRows.filter(
  (row) => row.external_ai_allowed,
).length;
const ragDoubtfulOcr = ragDocumentRows.filter((row) => row.ocr_doubtful).length;
const ragLegalMetadataMismatches = Object.entries(EXPECTED_LEGAL_DOCUMENTS)
  .filter(([id, expected]) => {
    const row = ragDocumentRows.find((document) => document.id === id);
    return !row || row.titulo !== expected.title || row.pdf_url !== expected.pdfUrl;
  })
  .length;
const lexicalRetrievalHealthy = lexicalRetrievalProbes.every(
  (probe) => probe.healthy,
);

function bucketReport(result, expectedMimeTypes) {
  const bucket = result.data;
  const allowedMimeTypes = Array.isArray(bucket?.allowed_mime_types)
    ? [...bucket.allowed_mime_types].sort()
    : [];
  const expected = [...expectedMimeTypes].sort();
  return {
    exists: !result.error && Boolean(bucket),
    private: bucket?.public === false,
    fileSizeLimit: Number(bucket?.file_size_limit ?? 0),
    allowedMimeTypes,
    error: result.error?.message || null,
    healthy:
      !result.error
      && bucket?.public === false
      && Number(bucket?.file_size_limit) === 10 * 1024 * 1024
      && JSON.stringify(allowedMimeTypes) === JSON.stringify(expected),
  };
}

const inspectionBucketReport = bucketReport(
  inspectionPhotoBucket,
  ["image/*"],
);
const expedienteBucketReport = bucketReport(
  expedienteDocumentBucket,
  ["application/pdf", "image/*"],
);

const report = {
  checkedAt: new Date().toISOString(),
  readOnly: true,
  records: {
    carteles: cartelesResult.data.length,
    inspecciones: inspections.count,
    expedientes: expedientes.count,
    solicitudesEstado: requests.count,
    auditoriaEventos: audits.count,
  },
  territorialLinks: linkCounts,
  approvedWithoutCompleteTrace: approvedWithoutTrace,
  migration13Preflight: {
    duplicateReservedFeatures,
    invalidLinkRowsAfterRatification,
    duplicateInspectionPhotoPaths,
    duplicateExpedienteDocumentPaths,
    ready:
      duplicateReservedFeatures === 0
      && invalidLinkRowsAfterRatification === 0
      && duplicateInspectionPhotoPaths === 0
      && duplicateExpedienteDocumentPaths === 0,
  },
  migrationSignals: {
    workflow12Readable: requests.ok && audits.ok,
    evidenceColumnsFrom13Readable:
      !photoColumns.error && !documentColumns.error,
    ragGovernanceFrom13Readable: !ragDocuments.error && !ragChunks.error,
    keepaliveFrom13Callable:
      !keepaliveRpc.error && keepaliveRpc.data === true,
    lexicalRetrievalFrom15Callable:
      lexicalRetrievalHealthy,
    allMigration13Signals:
      !photoColumns.error
      && !documentColumns.error
      && !ragDocuments.error
      && !ragChunks.error
      && !keepaliveRpc.error
      && keepaliveRpc.data === true,
    photoColumnsError: photoColumns.error?.code || null,
    documentColumnsError: documentColumns.error?.code || null,
    ragGovernanceError:
      ragDocuments.error?.code || ragChunks.error?.code || null,
    keepaliveError: keepaliveRpc.error?.code || null,
    lexicalRetrievalError:
      lexicalRetrievalProbes.find((probe) => probe.error)?.error || null,
  },
  ragCorpus: {
    documents: ragDocumentRows.length,
    chunks: ragChunkRows.length,
    declaredChunks: ragDeclaredChunks,
    contractVersion1: ragDocumentRows.length - ragLegacyContracts,
    legacyContracts: ragLegacyContracts,
    invalidHashes: ragInvalidHashes,
    invalidPageCounts: ragInvalidPageCounts,
    chunkCountMismatches: ragChunkCountMismatches,
    orphanDocumentIds: ragOrphanDocumentIds,
    humanReviewed: ragHumanReviewed,
    externalAiAllowed: ragExternalAiAllowed,
    doubtfulOcr: ragDoubtfulOcr,
    legalMetadataMismatches: ragLegalMetadataMismatches,
    healthy:
      !ragDocuments.error
      && !ragChunks.error
      && ragDocumentRows.length === EXPECTED_RAG_DOCUMENTS
      && ragChunkRows.length === EXPECTED_RAG_CHUNKS
      && ragDeclaredChunks === EXPECTED_RAG_CHUNKS
      && ragLegacyContracts === 0
      && ragInvalidHashes === 0
      && ragInvalidPageCounts === 0
      && ragChunkCountMismatches === 0
      && ragOrphanDocumentIds === 0
      && ragLegalMetadataMismatches === 0
      && ragExternalAiAllowed === 0,
  },
  ragRetrieval: {
    strategy: "fts-spanish-v1",
    probes: lexicalRetrievalProbes,
    healthy: lexicalRetrievalHealthy,
  },
  storageBuckets: {
    inspectionPhotos: inspectionBucketReport,
    expedienteDocuments: expedienteBucketReport,
    healthy:
      inspectionBucketReport.healthy && expedienteBucketReport.healthy,
  },
};

console.log(JSON.stringify(report, null, 2));
