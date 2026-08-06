import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import {
  findPotentialPii,
  hasPotentialPii,
  parseCitationReferences,
} from "../lib/external-ai-policy.ts";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

async function loadMapQueryModule() {
  const typescript = await source("data/map-query.ts");
  const javascript = ts.transpileModule(typescript, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const module = { exports: {} };
  const inspectionStates = [
    { key: "nuevo_relevamiento", label: "Nuevo relevamiento" },
    { key: "con_observaciones", label: "Con observaciones" },
  ];
  const requireForTest = (specifier) => {
    if (specifier === "@/data/inspections") {
      return { INSPECTION_STATE_ORDER: inspectionStates };
    }
    throw new Error(`Dependencia inesperada al cargar map-query.ts: ${specifier}`);
  };

  Function("require", "module", "exports", javascript)(
    requireForTest,
    module,
    module.exports,
  );
  return module.exports;
}

/** Permisos con los que se valida un intent (migración 16 / lib/roles.ts). */
const OPERATIVO = { canSeeFiscalData: true };
const CONSULTIVO = { canSeeFiscalData: false };

test("el parser acepta solo campos propios y datasets explícitamente válidos", async () => {
  const { isQueryField, parseQueryIntent } = await loadMapQueryModule();

  assert.equal(isQueryField("analysisStatus"), true);
  assert.equal(isQueryField("toString"), false);
  assert.equal(isQueryField("__proto__"), false);

  assert.equal(
    parseQueryIntent({ operation: "count", dataset: "administracion" }, OPERATIVO),
    null,
  );
  assert.equal(parseQueryIntent({ operation: "count", dataset: null }, OPERATIVO), null);

  const inheritedDataset = Object.create({ dataset: "administracion" });
  inheritedDataset.operation = "count";
  assert.equal(parseQueryIntent(inheritedDataset, OPERATIVO)?.dataset, "carteles");
});

test("el parser aplica una matriz estricta entre operador y tipo de campo", async () => {
  const { parsePredicate, parseQueryIntent } = await loadMapQueryModule();

  assert.deepEqual(
    parsePredicate({
      field: "analysisStatus",
      op: "eq",
      value: "dentro_corredor",
    }, OPERATIVO),
    { field: "analysisStatus", op: "eq", value: "dentro_corredor" },
  );
  assert.equal(
    parsePredicate({
      field: "analysisStatus",
      op: "contains",
      value: "corredor",
    }, OPERATIVO),
    null,
  );
  assert.equal(
    parsePredicate({
      field: "distanceToCorridorM",
      op: "eq",
      value: "50",
    }, OPERATIVO),
    null,
  );
  assert.equal(
    parsePredicate({
      field: "distanceToCorridorM",
      op: "in",
      value: ["50"],
    }, OPERATIVO),
    null,
  );
  assert.deepEqual(
    parsePredicate({
      field: "distanceToCorridorM",
      op: "lte",
      value: 50,
    }, OPERATIVO),
    { field: "distanceToCorridorM", op: "lte", value: 50 },
  );
  assert.deepEqual(
    parsePredicate({
      field: "empresaInspeccion",
      op: "contains",
      value: "ejemplo",
    }, OPERATIVO),
    { field: "empresaInspeccion", op: "contains", value: "ejemplo" },
  );

  assert.equal(
    parseQueryIntent({
      operation: "aggregate",
      dataset: "inspecciones",
      aggregate: { groupBy: "empresaInspeccion", top: 1.5 },
    }, OPERATIVO),
    null,
  );
  assert.equal(
    parseQueryIntent({
      operation: "aggregate",
      dataset: "inspecciones",
      aggregate: { groupBy: "empresaInspeccion", top: 101 },
    }, OPERATIVO),
    null,
  );
  assert.equal(
    parseQueryIntent({
      operation: "count",
      aggregate: { groupBy: "analysisStatus", top: 5 },
    }, OPERATIVO),
    null,
  );
});

test("una sesión de rol consulta no obtiene empresa ni CUIT por ninguna vía", async () => {
  const { isFiscalField, parsePredicate, parseQueryIntent } = await loadMapQueryModule();

  // 1. El catálogo marca como fiscales los dos campos que nombran a la empresa.
  assert.equal(isFiscalField("empresa"), true);
  assert.equal(isFiscalField("empresaInspeccion"), true);
  assert.equal(isFiscalField("analysisStatus"), false);

  // 2. Filtrar por razón social: rechazado, incluso anidado en un AND.
  assert.equal(
    parsePredicate({ field: "empresaInspeccion", op: "contains", value: "ejemplo" }, CONSULTIVO),
    null,
  );
  assert.equal(
    parsePredicate({
      op: "and",
      clauses: [
        { field: "estadoInspeccion", op: "eq", value: "con_observaciones" },
        { field: "empresaInspeccion", op: "contains", value: "ejemplo" },
      ],
    }, CONSULTIVO),
    null,
  );

  // 3. Rankear por empresa: rechazado. Es la vía por la que "¿qué empresa tiene
  //    más observaciones?" reconstruye la razón social sin mostrar el campo.
  const ranking = {
    operation: "aggregate",
    dataset: "inspecciones",
    aggregate: { groupBy: "empresaInspeccion", top: 5 },
    applyToMap: false,
    unsupported: [],
    explanation: "",
  };
  assert.notEqual(parseQueryIntent(ranking, OPERATIVO), null);
  assert.equal(parseQueryIntent(ranking, CONSULTIVO), null);

  // 4. Las consultas territoriales siguen funcionando para el rol consulta.
  assert.notEqual(
    parseQueryIntent({
      operation: "count",
      predicate: { field: "analysisStatus", op: "eq", value: "dentro_corredor" },
      applyToMap: false,
      unsupported: [],
      explanation: "",
    }, CONSULTIVO),
    null,
  );
});

test("la fuente de datos, el mapa y las exportaciones respetan el permiso fiscal", async () => {
  const [roles, cartelRepo, inspectionRepo, expedienteRepo, linker, ai, report, registro] =
    await Promise.all([
      source("lib/roles.ts"),
      source("lib/cartel-repository.ts"),
      source("lib/inspection-repository.ts"),
      source("lib/expediente-repository.ts"),
      source("lib/territorial-cartel-linker.ts"),
      source("lib/map-query-ai.ts"),
      source("lib/expediente-report.ts"),
      source("components/expedientes-registro.tsx"),
    ]);

  // El rol elige la fuente: tabla base solo para roles operativos.
  assert.match(roles, /return canSeeFiscalData\(role\) \? table : `\$\{table\}_consulta`/);
  assert.doesNotMatch(roles, /"consulta"[^\n]*OPERATIVE_ROLES/);

  // Ningún repositorio de datos fiscales consulta la tabla base a secas.
  for (const [name, code] of [
    ["carteles", cartelRepo],
    ["inspecciones", inspectionRepo],
    ["expedientes", expedienteRepo],
  ]) {
    assert.match(code, new RegExp(`fiscalSource\\("${name}", role\\)`));
  }
  assert.doesNotMatch(cartelRepo, /\.from\("carteles"\)\s*\n?\s*\.select\("\*"\)/);

  // El mapa no transporta los campos fiscales si la sesión no los recibió.
  assert.match(linker, /\.\.\.\(record\.empresa \? \{ empresa: record\.empresa \} : \{\}\)/);
  assert.match(linker, /\.\.\.\(record\.cuit \? \{ cuit: record\.cuit \} : \{\}\)/);
  assert.match(linker, /\.\.\.\(record\.padronCisi \? \{ padronCisi: record\.padronCisi \} : \{\}\)/);

  // La interpretación local se revalida siempre bajo los permisos de la sesión.
  assert.match(ai, /parseQueryIntent\(raw, permissions\)/);

  // Un informe exportado sobrevive a la sesión: no puede llevar razón social si
  // la interfaz se la oculta al rol.
  assert.match(report, /includeFiscalData/);
  assert.match(report, /includeFiscalData \? expediente\.empresa \|\| "" : RESTRICTED_BY_ROLE_LABEL/);
  assert.match(registro, /exportExpedientesXlsx\([\s\S]{0,200}auth\.canSeeFiscal/);
});

test("la política externa detecta PII explícita sin bloquear referencias normativas", () => {
  assert.equal(hasPotentialPii("¿Qué establece la Ordenanza 4728/2014?"), false);
  assert.equal(hasPotentialPii("Consulta del CUIT 30-12345678-9"), true);
  assert.equal(hasPotentialPii("DNI: 12.345.678"), true);
  assert.equal(hasPotentialPii("Escribir a persona@example.gob.ar"), true);
  assert.equal(hasPotentialPii("Padrón N.º 123456"), true);
  assert.equal(hasPotentialPii("Expediente N.º 4567/2026"), true);
  assert.equal(hasPotentialPii("Domicilio comercial: San Martín 123"), true);
  assert.equal(hasPotentialPii("Juan Pérez vive en Laprida 123"), true);
  assert.equal(hasPotentialPii("Visitar Av. Sarmiento 450"), true);
  assert.equal(hasPotentialPii("Sra. Ana Pérez presentó una nota"), true);
  assert.equal(hasPotentialPii("Contacto +54 9 381 555 1212"), true);
  assert.deepEqual(
    findPotentialPii("DNI: 12.345.678", "Teléfono: +54 381 555-1212").sort(),
    ["dni", "telefono"],
  );
});

test("las citas del proveedor deben ser [n], estar balanceadas y quedar dentro del rango", () => {
  assert.deepEqual(parseCitationReferences("Respuesta [1]. Otra fuente [2][1].", 2), [1, 2]);
  assert.equal(parseCitationReferences("Respuesta sin fuente.", 2), null);
  assert.equal(parseCitationReferences("Referencia inexistente [3].", 2), null);
  assert.equal(parseCitationReferences("Referencia cero [0].", 2), null);
  assert.equal(parseCitationReferences("Formato agrupado [1,2].", 2), null);
  assert.equal(parseCitationReferences("Corchete incompleto [1.", 2), null);
  assert.equal(parseCitationReferences("Enlace [texto](https://example.com).", 2), null);
});

test("el mapa no envía preguntas a IA externa y normativa usa retrieval serverless privado", async () => {
  const [client, askRoute, normativaRoute, envExample, normativeUi, packageManifest] = await Promise.all([
    source("lib/map-query-ai.ts"),
    source("app/api/ask/route.ts"),
    source("app/api/normativa/route.ts"),
    source(".env.example"),
    source("components/normativa-ask.tsx"),
    source("package.json").then(JSON.parse),
  ]);

  assert.doesNotMatch(client, /\bfetch\s*\(/);
  assert.doesNotMatch(client, /\/api\/ask|openrouter/i);
  assert.doesNotMatch(askRoute, /openrouter\.ai|OPENROUTER_API_KEY/);
  assert.match(normativaRoute, /ENABLE_EXTERNAL_NORMATIVA_AI\s*===\s*"true"/);
  assert.match(normativaRoute, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(normativaRoute, /admin\.rpc\("buscar_rag_chunks_lexico"/);
  assert.doesNotMatch(normativaRoute, /@\/lib\/embeddings|document-corpus/);
  assert.match(normativaRoute, /data\.every\(isMatchRow\)/);
  assert.match(normativaRoute, /sourcePdfHash:\s*m\.source_pdf_hash/);
  assert.match(normativaRoute, /m\.ingest_contract_version\s*===\s*1/);
  assert.match(normativaRoute, /note:\s*"fuente_restringida"/);
  assert.match(normativaRoute, /hasPotentialPii\(q,\s*context\)/);
  assert.match(normativaRoute, /parseCitationReferences\(answer,\s*citations\.length\)/);
  assert.match(normativeUi, /response\.status === 429/);
  assert.match(envExample, /ENABLE_EXTERNAL_NORMATIVA_AI=false/);
  assert.equal(packageManifest.dependencies["@huggingface/transformers"], undefined);
  assert.equal(
    packageManifest.devDependencies["@huggingface/transformers"],
    "^4.2.0",
  );
});

test("los documentos administrativos no forman parte del árbol público", async () => {
  const [
    publicFiles,
    publicCatalog,
    gitignore,
    vercelignore,
    { documents },
    { internalDocuments },
  ] = await Promise.all([
    readdir(new URL("../public/docs/", import.meta.url)),
    source("data/documents.ts"),
    source(".gitignore"),
    source(".vercelignore"),
    import("../data/documents.ts"),
    import("../data/internal-documents.ts"),
  ]);

  assert.deepEqual(publicFiles.sort(), [
    "decreto-0609-18.pdf",
    "ordenanza-4728-2014.pdf",
  ]);
  assert.doesNotMatch(publicCatalog, /relevamiento-|nota-secretaria|informe-instalaciones/i);
  assert.ok(
    [...documents, ...internalDocuments].every(
      (document) => !document.humanReviewed && !document.externalAiAllowed,
    ),
    "ningún documento queda habilitado para IA externa antes de revisión humana",
  );
  assert.match(gitignore, /^private\/$/m);
  assert.match(vercelignore, /^private$/m);
});

test("el padrón administrativo y sus seeds permanecen fuera del árbol versionable", async () => {
  const sensitivePaths = [
    "data/carteles.json",
    "supabase/seed.sql",
    "supabase/seed_part_1.sql",
    "supabase/seed_part_2.sql",
    "supabase/seed_part_3.sql",
  ];
  const [resolveScript, geocodeScript, seedScript] = await Promise.all([
    source("scripts/resolve-map-coordinates.mjs"),
    source("scripts/geocode-pending-addresses.mjs"),
    source("scripts/generate-supabase-seed.mjs"),
  ]);

  for (const path of sensitivePaths) {
    await assert.rejects(
      access(new URL(path, root)),
      (error) => error?.code === "ENOENT",
      `${path} no debe existir fuera de private/`,
    );
  }
  assert.match(resolveScript, /private\/data\/carteles\.json/);
  assert.match(geocodeScript, /private\/data\/carteles\.json/);
  assert.match(seedScript, /private\/data\/carteles\.json/);
  assert.match(seedScript, /private\/supabase/);
});
