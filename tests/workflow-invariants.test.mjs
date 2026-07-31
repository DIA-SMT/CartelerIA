import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

function sqlTransitions(sql, table) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = sql.match(
    new RegExp(
      `insert\\s+into\\s+public\\.${escaped}\\s*\\([^)]*\\)\\s*values([\\s\\S]*?)on\\s+conflict`,
      "i",
    ),
  );
  assert.ok(block, `No se encontró el catálogo SQL ${table}`);

  return [...block[1].matchAll(/\('([^']+)',\s*'([^']+)'\)/g)]
    .map(([, from, to]) => `${from}->${to}`)
    .sort();
}

function configuredTransitions(states) {
  return Object.values(states)
    .flatMap((state) => state.allowedNext.map((next) => `${state.key}->${next}`))
    .sort();
}

test("los catálogos de transiciones de UI y PostgreSQL coinciden", async () => {
  const [
    { INSPECTION_STATES },
    { EXPEDIENTE_STATES },
    workflowSql,
  ] = await Promise.all([
    import("../data/inspections.ts"),
    import("../data/expedientes.ts"),
    source("supabase/migrations/20260729_12_flujo_aprobaciones_auditoria.sql"),
  ]);

  assert.deepEqual(
    sqlTransitions(workflowSql, "inspeccion_transiciones"),
    configuredTransitions(INSPECTION_STATES),
  );
  assert.deepEqual(
    sqlTransitions(workflowSql, "expediente_transiciones"),
    configuredTransitions(EXPEDIENTE_STATES),
  );
});

test("la migración 13 contiene las barreras legales mínimas", async () => {
  const sql = await source(
    "supabase/migrations/20260729_13_integridad_legal.sql",
  );

  const invariants = [
    [
      "alta de inspección controlada",
      /before\s+insert(?:\s+or\s+update)?\s+on\s+public\.inspecciones/i,
    ],
    [
      "alta de expediente controlada",
      /before\s+insert(?:\s+or\s+update)?\s+on\s+public\.expedientes/i,
    ],
    ["vínculo aprobado obligatorio", /vinculo_estado\s*=\s*'aprobado'/i],
    ["ratificación de vínculos heredados", /vinculo_aprobado_por\s+is\s+null/i],
    ["repostulación de vínculo", /solicitar_vinculo_cartel/i],
    ["huella SHA-256", /sha256/i],
    [
      "fotos binarias no reemplazables",
      /drop\s+policy\s+if\s+exists\s+inspeccion_fotos_update\s+on\s+storage\.objects/i,
    ],
    [
      "documentos binarios no reemplazables",
      /drop\s+policy\s+if\s+exists\s+expediente_docs_update\s+on\s+storage\.objects/i,
    ],
    ["bitácora inmutable", /auditoria_eventos[\s\S]{0,2500}(inmutable|immutable)/i],
    [
      "actor humano y ejecutor técnico separados",
      /ejecutor_auth_role[\s\S]{0,1800}created_by/i,
    ],
  ];

  for (const [label, pattern] of invariants) {
    assert.match(sql, pattern, label);
  }

  const ledgerPosition = sql.indexOf(
    "create table if not exists public.evidencia_cargas",
  );
  const finalizerPosition = sql.indexOf(
    "create or replace function public.iniciar_finalizacion_evidencia",
  );
  assert.ok(ledgerPosition >= 0, "falta el ledger de cargas");
  assert.ok(
    finalizerPosition > ledgerPosition,
    "el ledger debe existir antes de compilar las RPC de finalización",
  );
  assert.match(sql, /public\.puede_subir_evidencia\(bucket_id,\s*name\)/i);
  assert.doesNotMatch(sql, /update\s+storage\.buckets/i);
  assert.doesNotMatch(
    sql,
    /create\s+trigger[\s\S]{0,200}\bon\s+storage\.objects/i,
  );
});

test("el corpus RAG queda privado, trazable, atómico y apto para serverless", async () => {
  const [sql, ragFixSql, lexicalSql, liveVerifier] = await Promise.all([
    source("supabase/migrations/20260729_13_integridad_legal.sql"),
    source("supabase/migrations/20260731_14_corregir_manifiesto_rag.sql"),
    source("supabase/migrations/20260731_15_busqueda_lexica_serverless.sql"),
    source("scripts/verify-live-integrity.mjs"),
  ]);

  assert.match(sql, /add column if not exists source_pdf_hash text/i);
  assert.match(sql, /add column if not exists ingest_contract_version integer/i);
  assert.match(sql, /create or replace function public\.sincronizar_documento_rag/i);
  assert.match(sql, /digest\(convert_to\(v_canonical_manifest,\s*'UTF8'\),\s*'sha256'\)/i);
  assert.match(sql, /v_existing\.ingest_contract_version\s*=\s*1/i);
  assert.match(
    sql,
    /rag_documentos_human_review_guard[\s\S]{0,500}ingest_contract_version\s*=\s*1/i,
  );
  assert.match(
    sql,
    /revoke all on table public\.rag_documentos\s+from public,\s*anon,\s*authenticated/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.match_rag_chunks\([\s\S]{0,120}\)\s+to service_role/i,
  );
  assert.doesNotMatch(
    sql,
    /grant execute on function public\.match_rag_chunks\([\s\S]{0,120}\)\s+to anon/i,
  );
  assert.match(sql, /create or replace function public\.consumir_cuota_api/i);
  assert.match(sql, /create or replace function public\.keepalive_ping/i);
  assert.match(
    lexicalSql,
    /create function public\.buscar_rag_chunks_lexico\(\s*p_query text,\s*p_match_count integer/i,
  );
  assert.match(lexicalSql, /create or replace function public\.normalizar_texto_rag/i);
  assert.match(lexicalSql, /generated always as[\s\S]{0,500}setweight/i);
  assert.match(lexicalSql, /create index if not exists rag_chunks_busqueda_lexica_idx/i);
  assert.doesNotMatch(lexicalSql, /or\s+d\.busqueda_lexica\s*@@/i);
  assert.match(lexicalSql, /string_agg\([\s\S]{0,120}quote_literal/i);
  assert.match(
    lexicalSql,
    /cobertura_chunk\.coincidencias\s*>=\s*1/i,
  );
  assert.match(lexicalSql, /ceil\(cardinality\(e\.terminos\)\s*\*\s*0\.4\)/i);
  assert.match(lexicalSql, /where c\.relevancia\s*>=\s*0\.30/i);
  assert.doesNotMatch(lexicalSql, /websearch_to_tsquery/i);
  for (const probe of [
    "¿Qué problemas genera la cartelería sin control?",
    "¿Qué proponen para ordenar la cartelería?",
    "¿Qué son los corredores publicitarios?",
    "Ordenanza 4728/2014",
    "Decreto 0609-18",
  ]) {
    assert.match(liveVerifier, new RegExp(probe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(
    lexicalSql,
    /grant execute on function public\.buscar_rag_chunks_lexico\(text, integer\)\s+to service_role/i,
  );
  assert.doesNotMatch(
    lexicalSql,
    /grant execute on function public\.buscar_rag_chunks_lexico\(text, integer\)\s+to (?:anon|authenticated)/i,
  );
  for (const migration of [sql, ragFixSql]) {
    assert.match(
      migration,
      /\|\|\s*':'\s*\|\|\s*\(item->>'contenido'\)/i,
      "el operador JSON final del manifiesto debe quedar parentizado",
    );
    assert.doesNotMatch(
      migration,
      /\|\|\s*':'\s*\|\|\s*item->>'contenido'/i,
      "la concatenación ambigua provoca SQLSTATE 42883",
    );
  }
});

test("la interfaz no vuelve a ofrecer atajos administrativos inseguros", async () => {
  const [form, header, keepalive, inspectionRepo, expedienteRepo, proposalGenerator] =
    await Promise.all([
      source("components/inspection-form.tsx"),
      source("components/header.tsx"),
      source(".github/workflows/supabase-keepalive.yml"),
      source("lib/inspection-repository.ts"),
      source("lib/expediente-repository.ts"),
      source("scripts/generate-territorial-link-proposals.mjs"),
    ]);

  assert.doesNotMatch(
    form,
    /options=\{INSPECTION_STATE_ORDER\.map/,
    "el alta no debe ofrecer todos los estados",
  );
  assert.doesNotMatch(header, /aria-label="(?:Buscar|Notificaciones)"/);
  assert.doesNotMatch(header, />Avisos</);
  assert.doesNotMatch(keepalive, /rest\/v1\/rag_documentos\?/);
  assert.match(keepalive, /rest\/v1\/rpc\/keepalive_ping/);
  assert.match(inspectionRepo, /SHA-256|sha256|subtle\.digest/i);
  assert.match(expedienteRepo, /SHA-256|sha256|subtle\.digest/i);
  assert.doesNotMatch(proposalGenerator, /update\s+public\.carteles/i);
  assert.match(proposalGenerator, /requires_administrator_approval/);
});
