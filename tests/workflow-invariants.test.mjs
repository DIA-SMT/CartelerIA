import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
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

test("la migración 16 gobierna los roles y cierra la lectura consultiva", async () => {
  const sql = await source(
    "supabase/migrations/20260806_16_gobernanza_identidades.sql",
  );

  // 1. Fundamento obligatorio y suficiente para cambiar un rol.
  assert.match(
    sql,
    /char_length\(btrim\(coalesce\(p_fundamento,\s*''\)\)\)\s*<\s*12/i,
    "asignar_rol debe exigir un fundamento de al menos 12 caracteres",
  );

  // 2. Nadie cambia su propio rol: lo valida la RPC y lo revalida el trigger.
  assert.match(sql, /if p_user_id = auth\.uid\(\) then\s*\n\s*raise exception 'Nadie puede cambiar su propio rol'/i);
  assert.match(sql, /if old\.user_id = auth\.uid\(\) then\s*\n\s*raise exception 'Nadie puede cambiar su propio rol'/i);

  // 3. La instancia no puede quedarse sin administradores.
  assert.match(sql, /raise exception 'La instancia no puede quedarse sin administradores'/i);
  assert.match(
    sql,
    /where p\.rol = 'administrador'::public\.app_rol\s*\n\s*and p\.user_id <> p_user_id/i,
    "la guarda debe contar administradores distintos del afectado",
  );

  // 4. Un UPDATE directo de `rol` falla: revoke + trigger con marcador de sesión.
  //    El revoke alcanza a service_role y el trigger cubre INSERT, para que
  //    borrar el perfil y volver a insertarlo no sea un ascenso silencioso.
  assert.match(
    sql,
    /revoke insert, update, delete on public\.perfiles from anon, authenticated, service_role/i,
  );
  assert.match(
    sql,
    /create trigger trg_perfiles_proteger_rol\s*\n\s*before insert or update on public\.perfiles/i,
  );
  assert.match(sql, /Un perfil nuevo solo puede nacer con rol consulta/i);
  // La guarda del último administrador se serializa: dos degradaciones
  // concurrentes dejarían la instancia sin ninguno.
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('public\.asignar_rol'\)\)/i);
  assert.match(sql, /current_setting\('app\.asignacion_rol',\s*true\)/i);
  assert.match(sql, /perform set_config\('app\.asignacion_rol',\s*p_user_id::text,\s*true\)/i);
  // Ni service_role puede mover un rol sin pasar por la RPC auditada.
  assert.match(
    sql,
    /coalesce\(auth\.role\(\),\s*''\)\s*=\s*'service_role'[\s\S]{0,400}El rol solo puede cambiarlo un administrador autenticado/i,
  );
  // El historial de roles es inmutable e insert-only.
  assert.match(
    sql,
    /create trigger trg_perfiles_historial_inmutable\s*\n\s*before update or delete on public\.perfiles_historial/i,
  );
  assert.match(
    sql,
    /revoke insert, update, delete on public\.perfiles_historial\s*\n\s*from anon, authenticated, service_role/i,
  );
  assert.match(sql, /revoke truncate on table\s*\n\s*public\.perfiles,\s*\n\s*public\.perfiles_historial/i);

  // 5. El rol `consulta` pierde empresa, CUIT y padrón en las tres tablas que
  //    los guardan. Las vistas no pueden reintroducir las columnas.
  for (const tabla of ["carteles", "inspecciones", "expedientes"]) {
    assert.match(
      sql,
      new RegExp(`create view public\\.${tabla}_consulta`, "i"),
      `falta la vista consultiva de ${tabla}`,
    );
  }
  const vistas = sql.slice(
    sql.indexOf("drop view if exists public.carteles_consulta"),
    sql.indexOf("-- Las tablas base quedan reservadas"),
  );
  assert.ok(vistas.length > 0, "no se pudo aislar el bloque de vistas consultivas");
  for (const columna of ["empresa", "cuit", "padron_cisi"]) {
    assert.doesNotMatch(
      vistas,
      new RegExp(`\\.${columna}\\b`),
      `la vista consultiva no puede exponer ${columna}`,
    );
  }
  for (const tabla of ["carteles", "inspecciones", "expedientes"]) {
    assert.doesNotMatch(
      sql,
      new RegExp(
        `create policy ${tabla}_(?:authenticated_read|select) on public\\.${tabla}[\\s\\S]{0,320}'consulta'`,
        "i",
      ),
      `la tabla base de ${tabla} no puede seguir abierta al rol consulta`,
    );
  }

  // 6. La evidencia no se entrega si no se pudo auditar: la ruta se resuelve y
  //    el acceso se registra en la misma transacción, y la lectura directa del
  //    bucket queda revocada.
  assert.match(sql, /create or replace function public\.autorizar_lectura_evidencia/i);
  const autorizacion = sql.slice(
    sql.indexOf("create or replace function public.autorizar_lectura_evidencia"),
    sql.indexOf("revoke all on function public.autorizar_lectura_evidencia"),
  );
  assert.match(
    autorizacion,
    /perform public\.registrar_acceso_sensible\([\s\S]{0,200}\)[\s\S]{0,200}return query/i,
    "el registro de acceso debe ocurrir antes de devolver las rutas",
  );
  // La lectura del bucket queda acotada al objeto propio. No se dropea del todo
  // porque un INSERT con RETURNING también pasa por las policies de SELECT y el
  // upload de evidencia dejaría de funcionar; lo que se cierra es la rama que
  // permitía firmar evidencia ajena sin pasar por la ruta auditada.
  for (const policy of ["inspeccion_fotos_read", "expediente_docs_read"]) {
    assert.match(sql, new RegExp(`drop policy if exists ${policy} on storage\\.objects`, "i"));
    assert.match(
      sql,
      new RegExp(`create policy ${policy} on storage\\.objects[\\s\\S]{0,220}owner_id = auth\\.uid\\(\\)::text`, "i"),
      `${policy} debe quedar acotada al objeto propio`,
    );
  }
  assert.doesNotMatch(
    sql,
    /create policy \w+_read on storage\.objects[\s\S]{0,400}exists\s*\(\s*\n?\s*select 1/i,
    "la lectura del bucket no puede volver a alcanzar evidencia ajena",
  );
  assert.match(
    sql,
    /grant execute on function public\.autorizar_lectura_evidencia\(text, uuid\[\], uuid, text\)\s*\n\s*to service_role/i,
  );
  assert.doesNotMatch(
    sql,
    /grant execute on function public\.autorizar_lectura_evidencia\([\s\S]{0,60}\)\s*\n?\s*to (?:anon|authenticated)/i,
  );
  assert.match(
    sql,
    /create trigger trg_acceso_datos_sensibles_inmutable\s*\n\s*before update or delete on public\.acceso_datos_sensibles/i,
  );
});

test("la evidencia solo se entrega por la ruta que la audita", async () => {
  const [route, client, inspectionRepo, expedienteRepo] = await Promise.all([
    source("app/api/evidence/access/route.ts"),
    source("lib/evidence-access.ts"),
    source("lib/inspection-repository.ts"),
    source("lib/expediente-repository.ts"),
  ]);

  // El navegador ya no firma evidencia: la lectura del bucket está revocada.
  for (const repo of [inspectionRepo, expedienteRepo]) {
    assert.doesNotMatch(repo, /createSignedUrls/);
    assert.match(repo, /requestEvidenceUrls\(/);
  }

  // La ruta replica las defensas de /api/ask y /api/normativa.
  assert.match(route, /rateLimit\(/);
  assert.match(route, /consumir_cuota_evidencia/);
  assert.match(route, /autorizar_lectura_evidencia/);
  assert.match(route, /"Cache-Control": "no-store"/);
  assert.match(route, /timeoutMs: DB_TIMEOUT_MS/);
  assert.match(route, /if \(!token\) return response\(\{ error: "unauthorized" \}, 401\)/);
  // Nunca devuelve el detalle del error al cliente.
  assert.doesNotMatch(route, /error:\s*\w*[Ee]rror\.message/);
  assert.match(route, /console\.error\(/);
  // Si algo falla, no se entrega ninguna URL.
  assert.match(route, /if \(!url\) return response\(\{ error: "sign_failed" \}, 503\)/);
  assert.match(client, /throw new Error\("No se pudo autorizar el acceso a la evidencia\."\)/);
});

test("ninguna cuenta nueva nace con rol privilegiado", async () => {
  // La migración 07 creaba cuentas como `administrador`. La 10 lo corrigió en
  // el repositorio, pero la instancia real siguió con la versión vieja durante
  // meses sin que nada lo avisara: se descubrió recién cuando el trigger de la
  // migración 16 rechazó un alta. Esta invariante fija que la ÚLTIMA definición
  // de handle_new_user asigne el rol mínimo.
  const migraciones = (await readdir(new URL("../supabase/migrations/", import.meta.url)))
    .filter((archivo) => archivo.endsWith(".sql"))
    .sort();

  let ultimaDefinicion = null;
  for (const archivo of migraciones) {
    const sql = await source(`supabase/migrations/${archivo}`);
    const bloque = sql.match(
      /create or replace function public\.handle_new_user\(\)[\s\S]*?\n\$\$;/i,
    );
    if (bloque) ultimaDefinicion = { archivo, cuerpo: bloque[0] };
  }

  assert.ok(ultimaDefinicion, "ninguna migración define handle_new_user");
  assert.match(
    ultimaDefinicion.cuerpo,
    /'consulta'/,
    `${ultimaDefinicion.archivo} debe asignar el rol consulta`,
  );
  assert.doesNotMatch(
    ultimaDefinicion.cuerpo,
    /'(administrador|coordinador|inspector)'/,
    `${ultimaDefinicion.archivo} no puede crear cuentas con rol privilegiado`,
  );

  // La migración 18 además lo verifica contra la base al aplicarse, porque leer
  // el repositorio no prueba nada sobre la instancia.
  const correccion = await source(
    "supabase/migrations/20260806_18_corregir_alta_de_cuentas.sql",
  );
  assert.match(correccion, /select p\.prosrc/i);
  assert.match(correccion, /raise exception 'handle_new_user seguiria creando cuentas/i);
});

test("la invitación crea la cuenta pero no se auto-otorga el rol", async () => {
  const route = await source("app/api/usuarios/invitar/route.ts");

  // Solo un administrador invita, y se verifica ANTES de crear nada.
  assert.match(route, /perfil\?\.rol !== "administrador"/);
  assert.ok(
    route.indexOf('perfil?.rol !== "administrador"') < route.indexOf("inviteUserByEmail"),
    "el control de rol debe ocurrir antes del alta",
  );

  // El rol lo asigna quien invita con su propio token, no service_role: así el
  // cambio queda en perfiles_historial con actor y fundamento reales.
  assert.match(route, /Authorization: `Bearer \$\{token\}`/);
  assert.match(route, /comoInvitante\.rpc\("asignar_rol"/);
  assert.doesNotMatch(route, /admin\.rpc\("asignar_rol"/);

  // Defensas de toda ruta nueva.
  assert.match(route, /rateLimit\(/);
  assert.match(route, /"Cache-Control": "no-store"/);
  assert.match(route, /createAdminClient\(\{ timeoutMs/);
  assert.doesNotMatch(route, /error:\s*\w*[Ee]rror\.message/);

  // Si falla la asignación, la cuenta queda en el rol MENOS privilegiado.
  assert.match(route, /rol: "consulta", rolAsignado: false/);
});

test("los indicadores se calculan en PostgreSQL y no inventan ceros", async () => {
  const [sql, repo, ui] = await Promise.all([
    source("supabase/migrations/20260806_17_indicadores_gestion.sql"),
    source("lib/indicadores-repository.ts"),
    source("components/indicadores-gestion.tsx"),
  ]);

  assert.match(
    sql,
    /create or replace function public\.indicadores_gestion\(\s*\n\s*p_desde date/i,
  );
  // El rol consulta no puede segmentar por empresa: el filtro reconstruye la
  // razón social aunque el campo nunca se muestre.
  assert.match(
    sql,
    /v_empresa is not null and v_rol = 'consulta'::public\.app_rol[\s\S]{0,160}raise exception/i,
  );
  // Solo agregados: ninguna razón social, CUIT ni padrón sale del RPC.
  const salida = sql.slice(sql.indexOf("select jsonb_build_object("), sql.indexOf("into v_resultado"));
  assert.ok(salida.length > 0, "no se pudo aislar la construcción del resultado");
  for (const columna of ["u.empresa", "u.cuit", "u.padron_cisi", "c.empresa", "c.cuit"]) {
    assert.doesNotMatch(
      salida,
      new RegExp(columna.replace(".", "\\.")),
      `el resultado no puede incluir ${columna}`,
    );
  }
  // Los siete indicadores del roadmap, cada uno con procedencia declarada.
  for (const clave of [
    "cobertura_territorial",
    "inspecciones_completadas",
    "tasa_regularizacion",
    "demora_primera_inspeccion",
    "demora_resolucion",
    "antiguedad_backlog",
    "calidad_datos",
  ]) {
    assert.match(sql, new RegExp(`'clave',\\s*'${clave}'`), `falta el indicador ${clave}`);
  }
  assert.equal((sql.match(/'procedencia',/g) ?? []).length, 7);
  // Un denominador en cero se declara insuficiente, no se divide.
  assert.equal((sql.match(/nullif\((?:cobertura|inspecciones_resumen|regularizacion|calidad)\./g) ?? []).length, 4);
  assert.match(sql, /'suficiente', cobertura\.registrados > 0/);

  // El cliente valida el contrato y muestra la insuficiencia como tal.
  assert.match(repo, /PROCEDENCIAS\.includes\(raw\.procedencia as Procedencia\)/);
  assert.match(repo, /contrato inesperado/);
  assert.match(ui, /if \(!indicador\.suficiente \|\| indicador\.valor === null\) return "Sin datos"/);
  // El cálculo no se replica en el navegador.
  assert.doesNotMatch(ui, /loadCarteles|loadInspections|loadExpedientes/);
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
