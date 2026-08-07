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

test("la matriz de permisos coincide con lo que aplica auth-provider", async () => {
  const { APP_ROLES, OPERATIVE_ROLES, PERMISSION_MATRIX, canSeeFiscalData } =
    await import("../lib/roles.ts");

  const fila = (accion) => {
    const encontrada = PERMISSION_MATRIX.find((item) => item.accion === accion);
    assert.ok(encontrada, `falta la fila "${accion}" en la matriz`);
    return encontrada;
  };

  // Escribir: es exactamente lo que AuthProvider usa para canInspect.
  assert.deepEqual(
    [...fila("Registrar inspecciones y evidencia").roles].sort(),
    [...OPERATIVE_ROLES].sort(),
  );

  // Ver datos fiscales: la matriz tiene que coincidir rol por rol con la
  // función que decide el permiso, no con una lista paralela.
  for (const rol of APP_ROLES) {
    assert.equal(
      fila("Ver empresa, CUIT y padrón").roles.includes(rol),
      canSeeFiscalData(rol),
      `la matriz y canSeeFiscalData discrepan en "${rol}"`,
    );
    assert.equal(
      fila("Filtrar y rankear por empresa").roles.includes(rol),
      canSeeFiscalData(rol),
      `filtrar por empresa debe seguir el mismo permiso fiscal en "${rol}"`,
    );
  }

  // Leer el registro: todos los roles reconocidos, ninguno más.
  assert.deepEqual([...fila("Leer el registro administrativo").roles].sort(), [...APP_ROLES].sort());

  // Administrar: exclusivo del administrador.
  for (const accion of ["Resolver aprobaciones", "Asignar roles", "Leer la bitácora y los accesos"]) {
    assert.deepEqual(fila(accion).roles, ["administrador"], `"${accion}" debe ser solo del administrador`);
  }

  // La matriz solo puede nombrar roles que existen.
  for (const item of PERMISSION_MATRIX) {
    for (const rol of item.roles) {
      assert.ok(APP_ROLES.includes(rol), `la matriz nombra un rol inexistente: ${rol}`);
    }
  }
});

test("Configuración es exclusiva del administrador y no entra al bundle inicial", async () => {
  const [shell, dashboard, sidebar] = await Promise.all([
    source("components/configuracion/index.tsx"),
    source("components/dashboard.tsx"),
    source("components/app-sidebar.tsx"),
  ]);

  // Guarda de rol antes de renderizar nada.
  assert.match(shell, /const isAdmin = auth\.canRead && auth\.role === "administrador"/);
  assert.match(shell, /if \(!isAdmin\) return null;/);
  assert.ok(
    shell.indexOf("if (!isAdmin) return null;") < shell.indexOf('<section id="configuracion"'),
    "la guarda de rol debe estar antes del marcado de la sección",
  );

  // Carga diferida: la sección más pesada no viaja a quien solo mira el mapa.
  assert.match(dashboard, /dynamic\(\(\) => import\("\.\/configuracion"\)/);
  // La sección vieja de usuarios no puede seguir existiendo en paralelo.
  assert.doesNotMatch(dashboard, /UsuariosAdmin/);
  assert.doesNotMatch(sidebar, /#usuarios/);

  // Pestañas accesibles y enlazables.
  assert.match(shell, /role="tablist"/);
  assert.match(shell, /role="tab"/);
  assert.match(shell, /role="tabpanel"/);
  assert.match(shell, /aria-selected=\{activo\}/);
  assert.match(shell, /ArrowRight/);
  assert.match(shell, /#configuracion\?tab=/);
});

test("el sidebar no ofrece gestión sin sesión con rol", async () => {
  const [sidebar, header] = await Promise.all([
    source("components/app-sidebar.tsx"),
    source("components/header.tsx"),
  ]);

  // El área de trabajo exige canRead; Administración exige además el rol.
  assert.match(sidebar, /const isAdmin = auth\.canRead && auth\.role === "administrador"/);
  assert.match(sidebar, /\.\.\.\(auth\.canRead\s*\n?\s*\?\s*\[\{\s*\n?\s*titulo: "Área de trabajo"/);
  assert.match(sidebar, /\.\.\.\(isAdmin\s*\n?\s*\?\s*\[\{\s*\n?\s*titulo: "Administración"/);

  // Un ítem administrativo no puede quedar en el grupo base.
  const navegacionBase = sidebar.slice(
    sidebar.indexOf("const NAVEGACION"),
    sidebar.indexOf("];", sidebar.indexOf("const NAVEGACION")),
  );
  for (const privado of ["#configuracion", "#aprobaciones", "#expedientes", "#indicadores"]) {
    assert.doesNotMatch(
      navegacionBase,
      new RegExp(privado),
      `${privado} no puede estar en la navegación pública`,
    );
  }

  // El header dejó de calcular navegación y de tener su propia trampa de foco.
  assert.doesNotMatch(header, /APPROVALS_COUNT_EVENT/);
  assert.doesNotMatch(header, /document\.body\.style\.overflow/);
  assert.doesNotMatch(header, /event\.key !== "Tab"/);
  assert.match(header, /<AppSidebar\/>/);
  // El único listener del contador vive en el sidebar.
  assert.match(sidebar, /APPROVALS_COUNT_EVENT/);
  // El cajón usa el sistema compartido en vez de reimplementarlo.
  assert.match(sidebar, /useModalShell\(panelRef\)/);
  assert.match(sidebar, /useDismissible\(onClose/);
  // Solo transform y opacity.
  assert.doesNotMatch(sidebar, /transition-\[?(width|left|box-shadow)/);
});

test("el menú y la página cuentan la misma historia", async () => {
  const [sidebar, dashboard] = await Promise.all([
    source("components/app-sidebar.tsx"),
    source("components/dashboard.tsx"),
  ]);

  // Orden del menú, tal como lo lista NAVEGACION.
  const bloqueNav = sidebar.slice(
    sidebar.indexOf("const NAVEGACION"),
    sidebar.indexOf("];", sidebar.indexOf("const NAVEGACION")),
  );
  const menu = [...bloqueNav.matchAll(/href: "(#[a-z]+)"/g)].map((m) => m[1]);

  // Orden en que el dashboard monta cada sección.
  const posicion = (marca) => {
    const indice = dashboard.indexOf(marca);
    assert.ok(indice > 0, `no se encontró ${marca} en el dashboard`);
    return indice;
  };
  const pagina = [
    ["#inicio", posicion("<Hero/>")],
    ["#mapa", posicion("<MapPreview")],
    ["#carteles", posicion("<CartelLibrary")],
    ["#normativa", posicion('id="normativa"')],
    ["#documentos", posicion("<PdfLibrary")],
    ["#corredores", posicion("<CorridorsSection/>")],
  ].sort((a, b) => a[1] - b[1]).map(([href]) => href);

  assert.deepEqual(
    menu,
    pagina,
    "el orden del menú dejó de coincidir con el de la página",
  );

  // El bloque de trabajo va después de todo lo consultivo.
  assert.ok(
    posicion("<IndicadoresGestion/>") > posicion("<CorridorsSection/>"),
    "las secciones de trabajo deben ir después del contenido consultivo",
  );
  assert.ok(
    posicion("<ExpedientesRegistro/>") > posicion("<CorridorsSection/>")
    && posicion("<ApprovalInbox/>") > posicion("<CorridorsSection/>"),
  );

  // Configuración salió del scroll: se muestra en lugar de la página.
  assert.match(dashboard, /mostrarConfiguracion \? \(/);
  assert.match(dashboard, /<Configuracion onVolver=/);
  // Y solo si además del hash hay rol administrador.
  assert.match(dashboard, /const mostrarConfiguracion = enConfiguracion && isAdmin/);
});

test("el asistente normativo nunca cita un proyecto sin sancionar", async () => {
  const [sql, route, lexicalSql] = await Promise.all([
    source("supabase/migrations/20260806_20_corpus_estado_legal.sql"),
    source("app/api/normativa/route.ts"),
    source("supabase/migrations/20260731_15_busqueda_lexica_serverless.sql"),
  ]);

  // El corpus distingue estados legales y solo admite los tres previstos.
  assert.match(sql, /add column if not exists estado_legal text not null default 'vigente'/i);
  assert.match(sql, /check \(estado_legal in \('vigente', 'derogada', 'proyecto'\)\)/i);

  // La RPC exige el estado: sin valor por omisión permisivo. Si alguien agrega
  // una ruta y se olvida del parámetro, falla en vez de devolver de más.
  assert.match(
    sql,
    /create function public\.buscar_rag_chunks_lexico\(\s*\n\s*p_query text,\s*\n\s*p_match_count integer,\s*\n\s*p_estados text\[\]\s*\n\)/i,
  );
  assert.doesNotMatch(sql, /p_estados text\[\]\s+default/i, "p_estados no puede tener default");
  // Sin estados válidos no devuelve nada.
  assert.match(sql, /where cardinality\(s\.permitidos\) > 0\s*\n\s*and d\.estado_legal = any\(s\.permitidos\)/i);
  // La versión vieja de dos parámetros se elimina, para que no quede una puerta
  // sin filtro colgada del esquema.
  assert.match(sql, /drop function if exists public\.buscar_rag_chunks_lexico\(text, integer\);/i);

  // La ruta pide explícitamente vigente...
  assert.match(route, /p_estados: \["vigente"\]/);
  // ...y además lo revalida en el contrato, por si la RPC cambiara.
  assert.match(route, /row\.estado_legal === "vigente"/);
  assert.doesNotMatch(route, /p_estados: \[[^\]]*"proyecto"/);

  // La normalización de la consulta sigue siendo la misma que alimenta el
  // índice: si divergieran, ninguna búsqueda con tildes encontraría nada.
  assert.match(sql, /public\.normalizar_texto_rag\(/);
  assert.match(lexicalSql, /create or replace function public\.normalizar_texto_rag/i);
  // Y la consulta sigue siendo OR entre lexemas, no exigencia de todos.
  assert.match(sql, /' \| '/);
});

test("el corte por artículo no inventa numeración", async () => {
  const { cortarPorArticulo, fragmentarArticulo } = await import("../lib/articulado.ts");

  // Estructura real del borrador municipal: guion largo y sumilla.
  const corte = cortarPorArticulo([
    "PROYECTO DE ORDENANZA",
    "TÍTULO I — DISPOSICIONES GENERALES",
    "Artículo 1.— Objeto y ámbito de aplicación",
    "La presente Ordenanza regula la publicidad exterior del ejido municipal.",
    "Alcanza a toda publicidad propia o de terceros.",
    "Artículo 2.— Definiciones",
    "A los fines de esta Ordenanza se entiende por anuncio publicitario todo mensaje.",
  ]);

  assert.equal(corte.estructurado, true);
  assert.equal(corte.articulos.length, 2);
  assert.equal(corte.titulos.length, 1);
  assert.equal(corte.articulos[0].numero, 1);
  assert.equal(corte.articulos[0].sumilla, "Objeto y ámbito de aplicación");
  assert.equal(corte.articulos[0].seccion, "Artículo 1");
  // El encabezado no queda dentro del cuerpo.
  assert.doesNotMatch(corte.articulos[0].texto, /^Artículo 1/);
  // Los párrafos siguientes se acumulan en el artículo abierto.
  assert.match(corte.articulos[0].texto, /Alcanza a toda publicidad/);
  assert.deepEqual(corte.avisos, []);

  // Un texto sin estructura NO siembra artículos: inventar una numeración es
  // peor que no tenerla.
  const plano = cortarPorArticulo([
    "Informe de relevamiento de cartelería del corredor norte.",
    "Se detectaron soportes sin identificación visible.",
  ]);
  assert.equal(plano.estructurado, false);
  assert.equal(plano.articulos.length, 0);
  assert.ok(plano.avisos.length > 0, "un texto sin estructura tiene que avisar");

  // Los huecos de numeración se informan, no se corrigen.
  const conHueco = cortarPorArticulo([
    "Artículo 1.— Primero",
    "Cuerpo del primero, con longitud suficiente para no dar aviso de vacío.",
    "Artículo 3.— Tercero",
    "Cuerpo del tercero, con longitud suficiente para no dar aviso de vacío.",
  ]);
  assert.equal(conHueco.articulos.length, 2);
  assert.ok(
    conHueco.avisos.some((aviso) => /Faltan los artículos 2/.test(aviso)),
    "un hueco de numeración tiene que avisarse",
  );
  assert.deepEqual(conHueco.articulos.map((a) => a.numero), [1, 3]);

  // Un artículo largo se parte, pero todos sus pedazos citan el mismo artículo.
  const largo = {
    numero: 7,
    sumilla: "Condiciones técnicas",
    texto: "Oración de prueba con longitud suficiente. ".repeat(80),
    seccion: "Artículo 7",
  };
  const partes = fragmentarArticulo(largo, 600);
  assert.ok(partes.length > 1, "un artículo largo debe partirse");
  assert.ok(partes.every((parte) => parte.seccion === "Artículo 7"));
  assert.ok(partes.every((parte) => parte.contenido.length <= 600));
});

test("la siembra del articulado no pisa trabajo hecho ni inventa aprobaciones", async () => {
  const [sql, script, { internalDocuments }] = await Promise.all([
    source("supabase/migrations/20260806_21_fabrica_normativa.sql"),
    source("scripts/ingest-docs.ts"),
    import("../data/internal-documents.ts"),
  ]);

  // El borrador entra como proyecto, nunca como vigente.
  const borrador = internalDocuments.find((doc) => doc.siembraArticulado);
  assert.ok(borrador, "falta el borrador que siembra el articulado");
  assert.equal(borrador.estadoLegal, "proyecto");
  assert.equal(borrador.audience, "interno");
  assert.equal(borrador.externalAiAllowed, false);
  // Y es el único: dos borradores sembrando el mismo proyecto es ambigüedad.
  assert.equal(internalDocuments.filter((doc) => doc.siembraArticulado).length, 1);

  // El script propaga el estado legal, con vigente como omisión.
  assert.match(script, /estado_legal: doc\.estadoLegal \?\? "vigente"/);

  // Reingerir un borrador corregido no puede pisar lo ya editado.
  assert.match(
    sql,
    /if v_existentes > 0 then\s*\n\s*raise exception 'El proyecto ya tiene % articulos: la siembra no pisa trabajo hecho'/i,
  );

  // Nada nace aprobado: la siembra solo escribe `propuesto`.
  const siembra = sql.slice(
    sql.indexOf("create or replace function public.sembrar_articulado"),
    sql.indexOf("revoke all on function public.crear_proyecto_norma"),
  );
  assert.ok(siembra.length > 0, "no se pudo aislar sembrar_articulado");
  assert.match(siembra, /'propuesto',\s*\n\s*'borrador_recibido'/);
  assert.doesNotMatch(siembra, /'aprobado'/, "la siembra no puede aprobar nada");
  // Y deja la versión 1 con el texto recibido: el historial arranca ahí.
  assert.match(siembra, /insert into public\.norma_articulo_version/);
  assert.match(siembra, /'Texto del borrador recibido'/);

  // El historial es inmutable y texto_original tiene su propia protección.
  assert.match(
    sql,
    /create trigger trg_norma_articulo_version_inmutable\s*\n\s*before update or delete on public\.norma_articulo_version/i,
  );
  assert.match(sql, /raise exception 'El texto original del borrador es inmutable'/i);
  assert.match(
    sql,
    /revoke insert, update, delete on public\.norma_articulo_version\s*\n\s*from anon, authenticated, service_role/i,
  );

  // Sin estructura reconocible no se siembra: inventar numeración es peor.
  assert.match(script, /if \(!corte\?\.estructurado\)/);
  assert.match(script, /articulado NO sembrado/);

  // El estado legal se fija SIEMPRE, cambie o no el texto. Acoplarlo a la
  // sincronización dejó el borrador marcado como vigente durante una tarde.
  assert.match(script, /fijar_estado_legal_documento/);
  const corridas = (script.match(/await fijarEstadoLegal\(/g) ?? []).length;
  assert.equal(corridas, 2, "el estado legal debe fijarse en los dos caminos: con y sin cambios");
  const siembras = (script.match(/await sembrarSiCorresponde\(/g) ?? []).length;
  assert.equal(siembras, 2, "la siembra debe intentarse aunque el documento no haya cambiado");

  // El proyecto es idempotente: reingerir no duplica.
  assert.match(sql, /Idempotente: un borrador da origen a un solo proyecto/i);
  assert.match(sql, /where p\.documento_origen_id = p_documento_origen_id/i);
});

test("un proyecto sin sancionar no puede volverse publico ni salir a IA externa", async () => {
  const sql = await source("supabase/migrations/20260806_22_estado_legal_efectivo.sql");

  // La RPC de estado legal es del script, no de la aplicación.
  assert.match(sql, /create or replace function public\.fijar_estado_legal_documento/i);
  assert.match(sql, /El estado legal de un documento lo fija el script de ingesta/i);
  assert.doesNotMatch(
    sql,
    /grant execute on function public\.fijar_estado_legal_documento\(text, text\)\s*\n\s*to authenticated/i,
  );

  // Red de seguridad: un proyecto nunca es público ni habilitado para IA.
  assert.match(
    sql,
    /new\.estado_legal = 'proyecto'\s*\n\s*and \(new\.external_ai_allowed or new\.audience = 'publico'\)/i,
  );
  assert.match(
    sql,
    /create trigger trg_rag_documentos_proyecto\s*\n\s*before insert or update on public\.rag_documentos/i,
  );

  // Y corrige el dato que quedó mal cargado.
  assert.match(sql, /set estado_legal = 'proyecto'\s*\n\s*where id = 'doc-16'/i);
});

test("guardar un articulo versiona y nunca sobrescribe", async () => {
  const [sql, ui] = await Promise.all([
    source("supabase/migrations/20260806_21_fabrica_normativa.sql"),
    source("components/fabrica/index.tsx"),
  ]);

  const guardar = sql.slice(
    sql.indexOf("create or replace function public.guardar_articulo"),
    sql.indexOf("create or replace function public.crear_articulo"),
  );
  assert.ok(guardar.length > 0, "no se pudo aislar guardar_articulo");

  // Cada guardado AGREGA una fila al historial y recién después actualiza el
  // texto vigente. Nunca hay un update que reemplace una version.
  assert.match(guardar, /insert into public\.norma_articulo_version/);
  assert.ok(
    guardar.indexOf("insert into public.norma_articulo_version")
      < guardar.indexOf("update public.norma_articulo"),
    "la version se escribe antes de mover el texto vigente",
  );
  assert.doesNotMatch(guardar, /update public\.norma_articulo_version/);
  assert.doesNotMatch(guardar, /delete from public\.norma_articulo_version/);
  // La version nueva es la siguiente, no un reemplazo de la anterior.
  assert.match(guardar, /v_siguiente := v_versiones \+ 1/);

  // Motivo obligatorio a partir del segundo guardado.
  assert.match(guardar, /v_versiones > 0 and char_length\(btrim\(coalesce\(p_motivo, ''\)\)\) < 12/);

  // Un articulo aprobado no se edita en silencio.
  assert.match(guardar, /raise exception 'Un articulo aprobado debe volver a revision antes de editarse'/);

  // Escribir exige rol operativo; el rol consulta no mueve estados.
  assert.match(guardar, /Escribir el articulado exige un rol operativo/);
  assert.match(sql, /El rol consulta no modifica el articulado/);

  // Aprobar es un acto administrativo, no una edicion mas.
  assert.match(
    sql,
    /p_estado = 'aprobado' and v_rol not in \(\s*\n\s*'administrador'::public\.app_rol,\s*\n\s*'coordinador'::public\.app_rol/i,
  );

  // La interfaz no deja mover un estado sin fundamento escrito.
  assert.match(ui, /disabled=\{motivo\.trim\(\)\.length < MOTIVO_MIN_LENGTH\}/);
  // Y el distintivo de proyecto sin sancionar es permanente, no una nota al pie.
  assert.match(ui, /Proyecto sin sancionar/);
  // El asistente todavia no escribe: no hay ninguna llamada que cree articulos
  // sin pasar por el editor.
  assert.doesNotMatch(ui, /crearArticulo\(/);
});

test("un fallo de carga se ve como error, nunca como carga eterna", async () => {
  // Todas estas pantallas usan el mismo patrón anti-carrera: no se muestran los
  // datos hasta que `dataOwnerId` coincide con la sesión. El riesgo es sutil: si
  // una salida temprana por error olvida marcar el dueño, `ownsData` queda en
  // false y el esqueleto tapa el mensaje de error para siempre. Pasó una vez en
  // la Fábrica y desde afuera parecía que la pantalla nunca terminaba de cargar.
  const pantallas = [
    "components/fabrica/index.tsx",
    "components/indicadores-gestion.tsx",
    "components/configuracion/tab-auditoria.tsx",
    "components/configuracion/tab-seguridad.tsx",
    "components/configuracion/tab-corpus.tsx",
    "components/configuracion/tab-usuarios.tsx",
  ];

  for (const ruta of pantallas) {
    const codigo = await source(ruta);
    const inicio = codigo.indexOf("const refresh = useCallback");
    assert.ok(inicio > 0, `${ruta}: no se encontró el refresh`);
    const fin = codigo.indexOf("useEffect(() => {", inicio);
    const refresh = codigo.slice(inicio, fin > inicio ? fin : undefined);

    const marcaDueño = refresh.indexOf("setDataOwnerId(auth.user?.id");
    assert.ok(marcaDueño > 0, `${ruta}: el refresh no marca el dueño de los datos`);

    // Si hay salidas tempranas después de cargar, el dueño ya tiene que estar
    // marcado antes de la primera.
    const primerErrorPhase = refresh.indexOf('setLoadPhase("error")');
    if (primerErrorPhase > 0) {
      assert.ok(
        marcaDueño < primerErrorPhase,
        `${ruta}: marca el dueño después de declarar el error, así el esqueleto tapa el mensaje`,
      );
    }
  }
});

test("una cita que no aparece textualmente se descarta", async () => {
  const { sanearFragmento, citaVerifica, verificarHallazgos } =
    await import("../lib/norma-citas.ts");

  // El saneado es UNO SOLO y se aplica al fragmento y a la cita. Si divergieran,
  // toda cita válida se descartaría por una diferencia invisible.
  const crudo = "Artículo 12.—  Las  superficies “máximas” se fijarán   por corredor.";
  const fragmento = sanearFragmento(crudo);
  assert.equal(fragmento, 'Artículo 12.— Las superficies "máximas" se fijarán por corredor.');

  // Una cita copiada del fragmento verifica.
  assert.equal(citaVerifica('Las superficies "máximas" se fijarán por corredor', [fragmento]), true);
  // Aunque el modelo la haya copiado con espacios de más: ese es el único
  // desvío que se tolera, porque lo produce el propio copiado.
  assert.equal(citaVerifica('Las  superficies  "máximas" se fijarán por corredor', [fragmento]), true);

  // Una cita inventada NO verifica, por verosímil que suene.
  assert.equal(
    citaVerifica("Las superficies máximas no podrán exceder los doce metros cuadrados", [fragmento]),
    false,
  );
  // Y una demasiado corta tampoco: verificaría por casualidad.
  assert.equal(citaVerifica("por corredor", [fragmento]), false);

  // El texto feo se cita tal cual: preferimos texto feo a texto inventado.
  const ocrFeo = sanearFragmento("PO ZOENLAM ATERN ID AD sera de cinco metros lineales");
  assert.equal(citaVerifica("PO ZOENLAM ATERN ID AD sera de cinco metros", [ocrFeo]), true);

  const { verificados, descartados } = verificarHallazgos(
    [
      { tipo: "contradiccion", severidad: "alta", descripcion: "Real", referencia: "Art. 12", cita: 'Las superficies "máximas" se fijarán por corredor', confianza: "alta" },
      { tipo: "vacio", severidad: "alta", descripcion: "Inventado", referencia: null, cita: "Queda prohibida toda publicidad en el microcentro historico", confianza: "alta" },
    ],
    [fragmento],
  );
  assert.equal(verificados.length, 1);
  assert.equal(verificados[0].descripcion, "Real");
  assert.equal(descartados.length, 1);
  assert.equal(descartados[0].descripcion, "Inventado");
  assert.match(descartados[0].motivo, /no aparece textualmente/);

  // La confianza arranca en baja si el modelo no la declara: aceptar un
  // hallazgo tiene que ser deliberado.
  const sinConfianza = verificarHallazgos(
    [{ tipo: "vacio", severidad: "media", descripcion: "X", referencia: null, cita: 'Las superficies "máximas" se fijarán por corredor' }],
    [fragmento],
  );
  assert.equal(sinConfianza.verificados[0].confianza, "baja");

  // Una lista vacía es una respuesta válida y frecuente.
  assert.deepEqual(verificarHallazgos([], [fragmento]).verificados, []);
});

test("un cartel sin superficie no cumple ni incumple: no es evaluable", async () => {
  const { simularArticulo, ParametroSinConfirmarError } =
    await import("../lib/norma-simulador.ts");

  const cartel = (id, superficie, distancia, situacion = "dentro_corredor") => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [0, 0] },
    properties: {
      id,
      analysisStatus: situacion,
      distanceToCorridorM: distancia,
      territorialContext: "corredor",
      administrative: superficie === undefined ? undefined : { recordId: id, linkStatus: "aprobado", superficieM2: superficie },
    },
  });

  const maximo12 = [{ clave: "superficie_maxima_m2", valor: 12, unidad: "m²", cita: "x", confirmado: true }];

  const { resumen, resultados } = simularArticulo(
    [
      cartel("a", 8, 10),      // cumple
      cartel("b", 20, 10),     // no cumple
      cartel("c", null, 10),   // sin superficie cargada
      cartel("d", undefined, 10), // sin registro administrativo
    ],
    maximo12,
  );

  assert.equal(resumen.cumple, 1);
  assert.equal(resumen.noCumple, 1);
  assert.equal(resumen.noEvaluable, 2, "los que no tienen superficie no son evaluables");
  assert.equal(resumen.total, 4);
  // Y se dice por qué campo quedaron afuera.
  assert.deepEqual(resumen.faltantes, [{ campo: "superficie declarada", cantidad: 2 }]);
  // Nunca se cuentan como que cumplen: eso le daría a una autoridad un número
  // tranquilizador que es falso.
  assert.equal(resultados.find((r) => r.cartelId === "c").cumplimiento, "no_evaluable");
  assert.equal(resultados.find((r) => r.cartelId === "d").cumplimiento, "no_evaluable");
  // Los tres valores suman el total: ninguno se pierde por el camino.
  assert.equal(resumen.cumple + resumen.noCumple + resumen.noEvaluable, resumen.total);
  assert.deepEqual(resumen.idsNoCumple, ["b"]);

  // Un incumplimiento comprobado manda sobre un dato faltante.
  const dosParametros = [
    ...maximo12,
    { clave: "distancia_minima_corredor_m", valor: 50, unidad: "m", cita: "y", confirmado: true },
  ];
  const mixto = simularArticulo([cartel("e", 20, null)], dosParametros);
  assert.equal(mixto.resumen.noCumple, 1, "si ya se sabe que incumple, no es no_evaluable");

  // La simulación NO corre con parámetros sin confirmar por una persona.
  assert.throws(
    () => simularArticulo([cartel("f", 8, 10)], [
      { clave: "superficie_maxima_m2", valor: 12, unidad: "m²", cita: "x", confirmado: false },
    ]),
    ParametroSinConfirmarError,
  );
  // Y falla, no ignora el parámetro en silencio.
  assert.throws(
    () => simularArticulo([cartel("f", 8, 10)], [
      { clave: "superficie_maxima_m2", valor: 12, unidad: "m²", cita: "x", confirmado: true },
      { clave: "zonas_habilitadas", valor: ["dentro_corredor"], unidad: null, cita: "z", confirmado: false },
    ]),
    /sin confirmar/,
  );
});

test("el asistente propone pero nunca guarda", async () => {
  const [route, sql] = await Promise.all([
    source("app/api/fabrica/route.ts"),
    source("supabase/migrations/20260806_23_diagnostico_normativo.sql"),
  ]);

  // La ruta no tiene ninguna vía para escribir el articulado.
  for (const escritura of ["guardar_articulo", "crear_articulo", "cambiar_estado_articulo", "confirmar_parametro"]) {
    assert.doesNotMatch(
      route,
      new RegExp(`rpc\\("${escritura}"`),
      `la ruta del asistente no puede llamar a ${escritura}`,
    );
  }
  // La propuesta vuelve al navegador, no a la base.
  assert.match(route, /asistido: true,\s*\n\s*suficiente: true/);

  // Y aunque quisiera, la RPC que confirma parámetros excluye a service_role:
  // pide una persona con rol operativo.
  assert.match(sql, /Confirmar un parametro exige un rol operativo/);
  assert.match(sql, /select a\.actor_id, a\.actor_rol into v_actor, v_rol from public\.actor_fabrica\(\)/);
  assert.doesNotMatch(
    sql,
    /grant execute on function public\.confirmar_parametro\([^)]*\) to service_role/i,
  );

  // Un parámetro necesita cita verificable EN el artículo.
  assert.match(sql, /position\(btrim\(p_cita\) in v_texto\) = 0/);
  assert.match(sql, /La cita no aparece textualmente en el articulo/);

  // Si la idea no alcanza, el asistente lo dice en vez de rellenar.
  assert.match(route, /suficiente: false/);
  assert.match(route, /NO rellenás/);
  // Y nunca inventa números que no estén en el contexto.
  assert.match(route, /No inventás números de artículo, de ordenanza, plazos, montos ni medidas/);
  // Una lista vacía de hallazgos es válida y frecuente.
  assert.match(route, /Devolver una lista vacía es una respuesta VÁLIDA y FRECUENTE/);

  // Misma política de IA externa que /api/normativa: nada sale del entorno sin
  // habilitación explícita del documento. Desde la migración 26 se decide
  // documento por documento en vez de bloquear la consulta entera.
  assert.match(route, /ENABLE_EXTERNAL_NORMATIVA_AI/);
  assert.match(route, /fragmento\.external_ai_allowed\s*$/m);
  assert.match(route, /fragmento\.human_reviewed\s*$/m);
  assert.match(route, /fragmento\.audience === "publico"/);
  // `ocr_doubtful` salió del predicado en la migración 28: lo cubre su propio
  // test, junto con por qué no se lo reemplazó por una tautología.
  assert.match(route, /hasPotentialPii\(consulta, contexto\)/);
  // El contexto sale SIEMPRE de la normativa vigente.
  assert.match(route, /p_estados: \["vigente"\]/);

  // Saneado una sola vez: lo que ve el modelo es contra lo que se verifica.
  assert.match(route, /const saneadosHabilitados = habilitados\.map\(\(fragmento\) => sanearFragmento/);
  assert.match(route, /verificarHallazgos\(\s*\n?\s*crudosHallazgos as HallazgoSinVerificar\[\],\s*\n?\s*saneadosHabilitados,?\s*\n?\s*\)/);

  // Defensas de toda ruta nueva, con cuota propia.
  assert.match(route, /rateLimit\(`fabrica:/);
  assert.match(route, /consumir_cuota_fabrica/);
  assert.doesNotMatch(route, /consumir_cuota_api|consumir_cuota_evidencia/);
  assert.match(route, /AbortSignal\.timeout\(LLM_TIMEOUT_MS\)/);
  assert.match(route, /"Cache-Control": "no-store"/);
  assert.doesNotMatch(route, /error:\s*\w*[Ee]rror\.message/);

  // Un diagnóstico se atiende, no se borra.
  assert.match(sql, /Un diagnostico no se borra: se atiende con fundamento/);
  assert.match(sql, /El contenido de un diagnostico es inmutable/);
});

test("la exportacion para elevar es fail-closed", async () => {
  const { ensamblarArticulado, evaluarElevacion, pieDelDocumento } =
    await import("../lib/norma-export.ts");

  const art = (id, orden, estado) => ({
    id, orden, estado, numero: null, sumilla: `S${orden}`,
    texto: "Texto del artículo con longitud suficiente para el documento.",
    origen: "borrador_recibido", textoOriginal: null, aprobadoEn: null, actualizadoEn: "",
  });

  // La numeración se recalcula al ensamblar: el `orden` es lo que manda, así
  // que reordenar no obliga a renumerar a mano.
  const desordenados = [art("c", 3, "aprobado"), art("a", 1, "aprobado"), art("b", 2, "aprobado")];
  assert.deepEqual(ensamblarArticulado(desordenados).map((a) => a.numero), [1, 2, 3]);
  assert.deepEqual(ensamblarArticulado(desordenados).map((a) => a.articuloId), ["a", "b", "c"]);

  // Un descartado sale del documento pero no se borra de la base.
  const conDescartado = [...desordenados, art("d", 4, "descartado")];
  assert.equal(ensamblarArticulado(conDescartado).length, 3);

  // Todo aprobado y sin diagnósticos graves: se puede elevar.
  assert.equal(evaluarElevacion(desordenados, []).puede, true);

  // Un artículo sin aprobar bloquea, y se dice cuál.
  const conPendiente = [art("a", 1, "aprobado"), art("b", 2, "en_revision")];
  const bloqueado = evaluarElevacion(conPendiente, []);
  assert.equal(bloqueado.puede, false);
  assert.equal(bloqueado.faltantes.length, 1);
  assert.equal(bloqueado.faltantes[0].tipo, "articulo_sin_aprobar");
  assert.equal(bloqueado.faltantes[0].articuloId, "b", "el faltante enlaza al artículo pendiente");
  assert.match(bloqueado.faltantes[0].detalle, /artículo 2/);

  // Un diagnóstico grave sin atender también bloquea.
  const conGrave = evaluarElevacion(desordenados, [
    { articuloId: "b", severidad: "alta", atendidoEn: null },
  ]);
  assert.equal(conGrave.puede, false);
  assert.equal(conGrave.faltantes[0].tipo, "diagnostico_grave_sin_atender");

  // Atendido, deja de bloquear.
  assert.equal(
    evaluarElevacion(desordenados, [{ articuloId: "b", severidad: "alta", atendidoEn: "2026-08-06" }]).puede,
    true,
  );
  // Y uno leve nunca bloqueó.
  assert.equal(
    evaluarElevacion(desordenados, [{ articuloId: "b", severidad: "media", atendidoEn: null }]).puede,
    true,
  );
  // Un diagnóstico grave sobre un artículo descartado no bloquea: ese artículo
  // no va en el documento.
  assert.equal(
    evaluarElevacion(conDescartado, [{ articuloId: "d", severidad: "alta", atendidoEn: null }]).puede,
    true,
  );

  // Un proyecto sin artículos no se eleva.
  assert.equal(evaluarElevacion([], []).puede, false);

  // El pie declara cómo se hizo el documento: es más defendible decirlo.
  const oficial = pieDelDocumento("Proyecto X", true);
  assert.match(oficial, /asistencia de herramientas automáticas y revisión humana/i);
  assert.match(oficial, /Versión para elevar/);
  const trabajo = pieDelDocumento("Proyecto X", false);
  assert.match(trabajo, /BORRADOR/);
  assert.match(trabajo, /No utilizar como documento oficial/);

  // La interfaz deshabilita el botón oficial y falla cerrado si no puede
  // verificar los diagnósticos.
  const ui = await source("components/fabrica/articulado-completo.tsx");
  assert.match(ui, /disabled=\{exportando \|\| cargando \|\| !evaluacion\?\.puede\}/);
  assert.match(ui, /if \(oficial && !evaluacion\?\.puede\) return;/);
  assert.match(ui, /puede: false,[\s\S]{0,200}No se pudieron verificar los diagnósticos/);
});

test("el documento impreso no se contradice sobre si es oficial", async () => {
  const ui = await source("components/fabrica/articulado-completo.tsx");
  const css = await source("app/globals.css");

  // Una sola fuente de verdad. Si la marca de borrador vuelve a mirar
  // `sinAprobar`, un articulado aprobado con un diagnóstico grave sin atender
  // sale sin marca arriba y con la leyenda de borrador abajo.
  assert.match(ui, /const esOficial = Boolean\(evaluacion\?\.puede\);/);
  assert.match(ui, /\{!esOficial && <p className="marca-borrador">/);
  assert.match(ui, /pieDelDocumento\(proyecto\.titulo, esOficial\)/);
  assert.doesNotMatch(
    ui,
    /sinAprobar > 0 && <p className="marca-borrador"/,
    "la marca de borrador no puede depender solo de los artículos sin aprobar",
  );
  assert.doesNotMatch(
    ui,
    /pieDelDocumento\([^)]*sinAprobar/,
    "el pie tiene que leer la misma evaluación que la marca",
  );
  // Mientras carga no se sabe, y no saber no es estar en condiciones.
  assert.match(ui, /const motivoBorrador = cargando/);

  // El panel se monta por portal: sin eso la regla de impresión no apaga nada
  // y se imprime el tablero entero.
  assert.match(ui, /return createPortal\(/);
  assert.match(ui, /className="print-root fixed/);
  assert.match(ui, /document\.body,\s*\);/);
  assert.match(css, /body > \*:not\(\.print-root\) \{ display: none !important; \}/);

  // La espera del montaje va en un componente de afuera: `useModalShell` lee su
  // ref al montarse y una sola vez, así que un `return null` con el hook ya
  // llamado dejaría el overlay sin scroll lock ni focus trap para siempre.
  assert.match(
    ui,
    /export function ArticuladoCompleto\(props: PropsArticulado\) \{[\s\S]{0,240}if \(!montado\) return null;[\s\S]{0,80}<PanelArticulado \{\.\.\.props\}/,
    "el guard de montaje tiene que envolver al panel, no vivir adentro",
  );
  assert.doesNotMatch(
    ui,
    /useModalShell\(panelRef\);[\s\S]{0,900}if \(!montado\) return null;/,
    "no puede haber un return antes de que el ref del panel exista",
  );

  // La marca corriente se repite por página con el único mecanismo que los
  // navegadores implementan. `position: running()` no es uno de ellos.
  assert.match(css, /\.documento-normativo \.marca-corriente \{ display: table-header-group; \}/);
  assert.match(css, /\.documento-normativo \.cuerpo \{ display: table-row-group; \}/);
  assert.doesNotMatch(css, /position: running\(/, "position: running() no existe en los navegadores");

  // El nombre del archivo es el mismo salga por Word o por PDF.
  assert.match(ui, /document\.title = nombreDocumento\(esOficial\);/);
  assert.match(ui, /window\.addEventListener\("afterprint", restaurar\);/);
  const exportador = await source("lib/norma-export.ts");
  assert.match(exportador, /enlace\.download = `\$\{nombreDocumento\(input\.oficial\)\}\.docx`;/);
});

test("la salida hacia IA externa se autoriza por documento y se declara que no vio el modelo", async () => {
  const sql = await source("supabase/migrations/20260806_26_habilitacion_ia_externa.sql");
  const ruta = await source("app/api/fabrica/route.ts");
  const aviso = await source("components/fabrica/fragmentos-vigente.tsx");

  // Habilitar es un acto administrativo, no una bandera que se toca a mano.
  assert.match(sql, /coalesce\(auth\.role\(\), ''\) = 'service_role'/);
  assert.match(sql, /v_rol is distinct from 'administrador'::public\.app_rol/);
  assert.match(sql, /char_length\(btrim\(coalesce\(p_fundamento, ''\)\)\) < 12/);
  assert.match(
    sql,
    /insert into public\.auditoria_eventos[\s\S]{0,700}'fundamento', btrim\(p_fundamento\)/,
    "el fundamento tiene que quedar al lado del antes y el después",
  );
  assert.match(
    sql,
    /revoke all on function public\.habilitar_documento_ia_externa\(text, boolean, boolean, text\)\s*from public, anon, service_role;/,
  );

  // Dos barreras que no dependen de quién llame.
  assert.match(sql, /Un documento interno no sale del municipio/);
  assert.match(sql, /un proyecto sin sancionar, nunca/);
  assert.match(sql, /Un documento sin revision humana no se habilita para IA externa/);
  // Y esas barreras son SOLO al habilitar: apagar tiene que poder hacerse ya.
  assert.match(sql, /if p_ia_externa then[\s\S]{0,900}end if;\s*update public\.rag_documentos/);

  // La ruta filtra en vez de bloquear: antes un solo fragmento restringido
  // cortaba la consulta entera, así que habilitar un documento no servía de nada.
  assert.doesNotMatch(
    ruta,
    /const fuenteRestringida = fragmentos\.some/,
    "un fragmento restringido no puede volver a bloquear toda la consulta",
  );

  // Y son DOS búsquedas: la función corta en 8 filas antes de mirar quién puede
  // salir, así que filtrar el resultado deja afuera lo único que servía.
  const busqueda = await source("supabase/migrations/20260806_27_busqueda_solo_habilitados.sql");
  assert.match(busqueda, /drop function if exists public\.buscar_rag_chunks_lexico\(text, integer, text\[\]\);/);
  assert.match(
    busqueda,
    /not coalesce\(p_solo_ia_externa, false\)\s*or \(\s*d\.audience = 'publico'\s*and d\.human_reviewed\s*and d\.external_ai_allowed\s*and not d\.ocr_doubtful\s*\)/,
    "el filtro tiene que ser el mismo que aplica la ruta antes de mandar nada afuera",
  );
  assert.match(
    busqueda,
    /and d\.estado_legal = any\(s\.permitidos\)/,
    "el estado legal sigue siendo obligatorio: el borrador no se cita",
  );
  assert.match(ruta, /const \[general, habilitada\] = await Promise\.all\(\[buscar\(false\), buscar\(true\)\]\)/);
  assert.match(ruta, /const sinHabilitados = habilitados\.length === 0;/);
  // La búsqueda restringida ya filtró, pero lo que sale se comprueba igual acá.
  assert.match(ruta, /\.filter\(puedeSalir\)/);

  // Los otros dos que llaman a la misma función quedaron con la firma nueva.
  const normativa = await source("app/api/normativa/route.ts");
  const verificador = await source("scripts/verify-live-integrity.mjs");
  assert.match(normativa, /p_solo_ia_externa: false/);
  assert.match(verificador, /p_estados: \["vigente"\],\s*p_solo_ia_externa: false/);

  // Las citas se verifican contra lo que el modelo VIO. Contra todo, una cita
  // inventada que coincidiera con un fragmento retenido pasaría por verificada.
  assert.match(ruta, /verificarHallazgos\(\s*crudosHallazgos as HallazgoSinVerificar\[\],\s*saneadosHabilitados,\s*\)/);
  assert.match(ruta, /const saneadosHabilitados = habilitados\.map/);

  // Y el precio de filtrar se declara: un "sin hallazgos" calculado sin ver
  // todo no es un certificado de que no hay conflicto.
  // `visto` sale del conjunto que efectivamente fue al modelo, no de volver a
  // evaluar la regla: si el contexto se armara distinto, la marca mentiría.
  assert.match(ruta, /const vistos = new Set\(habilitados\.map/);
  assert.match(ruta, /visto: vistos\.has\(/);
  assert.match(aviso, /El asistente no vio \{sinVer\.length\} de los \{fragmentos\.length\} fragmentos/);
  assert.match(aviso, /no quiere decir que no haya conflicto/);
});

test("un articulo nuevo guarda que se pidio y quien lo escribio", async () => {
  const sql = await source("supabase/migrations/20260806_25_articulo_nuevo_con_motivo.sql");
  const lienzo = await source("components/fabrica/lienzo-articulo.tsx");
  const repo = await source("lib/fabrica-repository.ts");
  const ruta = await source("app/api/fabrica/route.ts");

  // La sobrecarga vieja se borra: `create or replace` con distinta cantidad de
  // argumentos deja dos funciones vivas y PostgREST elige por nombre de
  // argumento, así que la de cuatro seguiría creando artículos sin motivo.
  assert.match(sql, /drop function if exists public\.crear_articulo\(uuid, text, text, text\);/);
  assert.match(sql, /create or replace function public\.crear_articulo\(\s*p_proyecto_id uuid,\s*p_texto text,\s*p_sumilla text,\s*p_origen text,\s*p_motivo text\s*\)/);

  // El motivo es obligatorio y es lo que se graba en la versión 1. Antes era la
  // constante 'Redaccion inicial', que no dice nada.
  assert.match(sql, /char_length\(btrim\(coalesce\(p_motivo, ''\)\)\) < 12/);
  assert.match(
    sql,
    /insert into public\.norma_articulo_version[\s\S]{0,400}v_rol, btrim\(p_motivo\)/,
    "la versión 1 tiene que llevar el motivo de la persona",
  );
  assert.doesNotMatch(sql, /'Redaccion inicial'/);

  // Un artículo nuevo nunca puede declararse como recibido en el borrador: eso
  // lo volvería intocable por el trigger de `texto_original`.
  assert.match(sql, /p_origen not in \('redactado', 'asistente'\)/);

  // El lienzo declara `asistente` SOLO si el texto lo escribió la máquina.
  assert.match(lienzo, /origen: vieneDelAsistente \? "asistente" : "redactado"/);
  assert.match(lienzo, /setVieneDelAsistente\(true\);/);
  assert.match(
    lienzo,
    /motivo: idea\.trim\(\)/,
    "la idea en criollo es el motivo de la versión: es el rastro de la autoría",
  );

  // Y sigue sin escribir nada por su cuenta: la ruta propone y la persona crea.
  assert.doesNotMatch(ruta, /crear_articulo|guardar_articulo|cambiar_estado_articulo/);
  assert.match(repo, /accion: "proponer_articulo", idea/);

  // Que el asistente pida definiciones no es un error y no se muestra como tal.
  assert.match(lienzo, /if \(!propuesta\.suficiente\) \{/);
  assert.match(lienzo, /El asistente necesita que definas esto primero/);
  assert.doesNotMatch(
    lienzo,
    /setError\(propuesta\.falta/,
    "pedir una definición no es una falla del asistente",
  );

  // Sin IA el lienzo sigue creando artículos a mano: se degrada la asistencia,
  // no la herramienta.
  assert.match(lienzo, /MOTIVO_ASISTENTE\[propuesta\.motivo \?\? ""\]/);
  assert.match(lienzo, /Podés escribir el artículo vos mismo/);

  // El texto tipeado no se pierde por un clic afuera ni por Escape.
  assert.match(lienzo, /if \(hayTrabajo\) \{ setConfirmarSalida\(true\); return; \}/);
  assert.match(lienzo, /if \(confirmDialogIsOpen\(\)\) return;/);
});

test("la correccion del OCR vuelve al archivo sin falsear la medicion", async () => {
  const { leerArchivoOcr, aplicarCorreccion, contarCambios } = await import("../lib/ocr-archivo.ts");
  const hash = "a".repeat(64);
  const base = {
    docId: "doc-06", archivo: "ordenanza-4728-2014.pdf", sourceHash: hash,
    paginasTotal: 2, confianzaMedia: 79, dudosa: false,
    paginas: [
      { pagina: 1, fuente: "ocr", confianza: 90, texto: "TICULO 1 texto con errores del OCR" },
      { pagina: 2, fuente: "ocr", confianza: 41, texto: "pagina que el OCR leyo mal" },
    ],
  };

  // Se valida lo mismo que valida el ingest, para decirlo mientras se edita y
  // no cuando el script lo descarta con un aviso en la consola.
  assert.equal(leerArchivoOcr("no es json", "doc-06").ok, false);
  assert.equal(leerArchivoOcr(JSON.stringify(base), "doc-02").ok, false, "no acepta el archivo de otro documento");
  assert.equal(
    leerArchivoOcr(JSON.stringify({ ...base, paginas: [base.paginas[0]] }), "doc-06").ok,
    false,
    "no acepta un juego incompleto de páginas",
  );
  assert.equal(
    leerArchivoOcr(JSON.stringify({ ...base, sourceHash: "corto" }), "doc-06").ok,
    false,
    "sin la huella del PDF no se sabe de dónde salió el texto",
  );
  assert.equal(
    leerArchivoOcr(JSON.stringify({ ...base, paginas: [base.paginas[1], base.paginas[0]] }), "doc-06").ok,
    true,
    "las páginas desordenadas se ordenan, no se rechazan",
  );

  const { archivo } = leerArchivoOcr(JSON.stringify(base), "doc-06");
  const corregido = aplicarCorreccion(
    archivo,
    ["ARTÍCULO 1 texto corregido a mano", archivo.paginas[1].texto],
    "2026-08-06T12:00:00.000Z",
  );

  // Lo que NO se toca. La huella ata el texto a un PDF concreto: cambiarla
  // sería afirmar que salió de uno del que no salió.
  assert.equal(corregido.sourceHash, hash);
  // Y la confianza es una medición del motor de OCR. Bajarla o subirla porque
  // una persona corrigió el texto sería falsear una medida.
  assert.equal(corregido.paginas[0].confianza, 90);
  assert.equal(corregido.paginas[1].confianza, 41);
  assert.equal(corregido.dudosa, false);

  // Lo que sí se agrega: el registro de que hubo mano humana, por página.
  assert.equal(corregido.paginas[0].texto, "ARTÍCULO 1 texto corregido a mano");
  assert.equal(corregido.paginas[0].corregidaPorHumano, true);
  assert.equal(corregido.paginas[1].corregidaPorHumano, false, "una página intacta no se marca");
  assert.deepEqual(corregido.correccionHumana, { fecha: "2026-08-06T12:00:00.000Z", paginas: [1] });

  // Sin cambios no se inventa un registro de corrección.
  const sinTocar = aplicarCorreccion(archivo, archivo.paginas.map((p) => p.texto), "2026-08-06T12:00:00.000Z");
  assert.equal(sinTocar.correccionHumana, undefined);
  assert.equal(contarCambios(archivo, archivo.paginas.map((p) => p.texto)), 0);
  assert.equal(contarCambios(archivo, ["otro texto", archivo.paginas[1].texto]), 1);

  // La corrección se descarga: no se guarda en la base, porque el ingest deriva
  // los fragmentos del archivo y la próxima reingesta la pisaría sin avisar.
  const editor = await source("components/configuracion/corregir-ocr.tsx");
  assert.match(editor, /enlace\.download = `\$\{documentoId\}\.json`/);
  assert.doesNotMatch(editor, /supabase|\.rpc\(|\.from\(/, "el editor no escribe en la base");
  assert.match(editor, /npm run ingest:docs/);
});

test("el OCR dudoso deja de vetar cuando una persona reviso", async () => {
  const sql = await source("supabase/migrations/20260806_28_ocr_dudoso_revisado.sql");
  const ruta = await source("app/api/fabrica/route.ts");

  // La firma no cambia: alcanza con `create or replace` y no hay sobrecarga que
  // borrar, a diferencia de la 27.
  assert.match(sql, /create or replace function public\.buscar_rag_chunks_lexico\(\s*p_query text,\s*p_match_count integer,\s*p_estados text\[\],\s*p_solo_ia_externa boolean\s*\)/);
  assert.doesNotMatch(sql, /drop function if exists public\.buscar_rag_chunks_lexico/);

  // El OCR dudoso ya no aparece en el predicado de salida, ni en el SQL ni en
  // la ruta. Y no se reemplaza por `or human_reviewed`, que sería una
  // tautología: la revisión humana ya es obligatoria en las dos.
  const predicadoSql = sql.slice(sql.indexOf("not coalesce(p_solo_ia_externa"), sql.indexOf("and length(e.texto)"));
  assert.match(predicadoSql, /d\.audience = 'publico'\s*and d\.human_reviewed\s*and d\.external_ai_allowed/);
  assert.doesNotMatch(predicadoSql, /ocr_doubtful/, "el OCR dudoso no vuelve al predicado de salida");

  const predicadoRuta = ruta.slice(ruta.indexOf("const puedeSalir"), ruta.indexOf("const habilitados"));
  assert.match(predicadoRuta, /fragmento\.audience === "publico"\s*&& fragmento\.human_reviewed\s*&& fragmento\.external_ai_allowed\s*\);/);
  assert.doesNotMatch(predicadoRuta, /ocr_doubtful/);

  // Pero la columna sigue existiendo y la pantalla la muestra: la duda de la
  // máquina se contesta, no se borra.
  const panel = await source("components/configuracion/revisar-documento.tsx");
  assert.match(panel, /documento\.ocrDudoso &&/);
  assert.match(panel, /La duda es de la máquina y no se borra/);
});

test("el articulo no trae puesto su propio numero", async () => {
  const { quitarEncabezadoArticulo } = await import("../lib/articulado.ts");
  const cuerpo = "La superficie máxima permitida para un cartel publicitario colocado en la vía pública será de seis metros cuadrados por cara.";

  // El caso que aparecio de verdad: el modelo pone una equis de relleno porque
  // no sabe que numero le toca. Hace bien en no inventarlo, pero el encabezado
  // no va: la numeracion la asigna el ensamblado segun la posicion, y el
  // documento saldria con el numero dos veces.
  for (const encabezado of [
    "ARTÍCULO X.- ", "Artículo X.— ", "ARTICULO 12.- ", "Art. 5: ",
    "Artículo 1º ", "ARTÍCULO IV.- ", "artículo 3 bis.- ", "Artículo 7) ",
  ]) {
    assert.equal(
      quitarEncabezadoArticulo(encabezado + cuerpo),
      cuerpo,
      `no limpió "${encabezado}"`,
    );
  }

  // Lo que NO se toca: un texto que arranca por su contenido, y uno que
  // menciona un artículo sin ser un encabezado.
  assert.equal(quitarEncabezadoArticulo(cuerpo), cuerpo);
  const referencia = "Lo dispuesto en el artículo 4 de la presente no se aplica a los soportes propios.";
  assert.equal(quitarEncabezadoArticulo(referencia), referencia);

  // Y si sacar el encabezado dejara casi nada, era el artículo entero: se
  // devuelve el original antes que un texto mutilado.
  assert.equal(quitarEncabezadoArticulo("ARTÍCULO 1.- Derógase."), "ARTÍCULO 1.- Derógase.");

  // La ruta lo aplica a la propuesta, y el prompt además lo prohíbe.
  const ruta = await source("app/api/fabrica/route.ts");
  assert.match(ruta, /\? quitarEncabezadoArticulo\(propuesta\.texto\)/);
  assert.match(ruta, /NO encabezás el texto con "ARTÍCULO N"/);
});

test("el articulo abierto vive en la URL y sobrevive a la ida y vuelta", async () => {
  const fabrica = await source("components/fabrica/index.tsx");
  const dashboard = await source("components/dashboard.tsx");
  const sidebar = await source("components/app-sidebar.tsx");

  // La selección está en el hash, con el mismo formato que las pestañas de
  // Configuración.
  assert.match(fabrica, /#fabrica\?articulo=\$\{articuloId\}/);
  assert.match(fabrica, /new URLSearchParams\(hash\.slice\(separador \+ 1\)\)\.get\("articulo"\)/);
  assert.match(
    fabrica,
    /useState<string \| null>\(articuloDelHash\)/,
    "el estado inicial tiene que salir de la URL, no de null",
  );

  // `replaceState` y no `location.hash`: asignar el hash scrollea a la sección
  // y saca el foco del editor en cada tecla.
  assert.match(fabrica, /window\.history\.replaceState\(null, "", destino\)/);
  // Ojo con el `===` de la comparación: solo se prohíbe la asignación.
  assert.doesNotMatch(
    fabrica,
    /window\.location\.hash\s*=[^=]/,
    "la Fábrica no debe asignar el hash: usa replaceState",
  );

  // Un solo camino para abrir un artículo, para que estado y URL no se separen.
  assert.match(fabrica, /onClick=\{\(\) => seleccionar\(articulo\.id\)\}/);
  assert.match(fabrica, /onIrAlArticulo=\{seleccionar\}/);
  assert.doesNotMatch(
    fabrica,
    /onClick=\{\(\) => setSeleccionId\(/,
    "abrir un artículo tiene que pasar por seleccionar(), que también escribe la URL",
  );

  // Limpiar un id inexistente recién con el articulado cargado: hacerlo antes
  // descartaría una selección válida solo por llegar primero.
  assert.match(
    fabrica,
    /if \(loadPhase !== "ready" \|\| seleccionId === null \|\| articulos\.length === 0\) return;/,
  );

  // La sección se abre por prefijo. Si esto pasara a comparación exacta, un
  // enlace con artículo dejaría de abrir la Fábrica.
  assert.match(dashboard, /hash\.startsWith\("#fabrica"\)/);
  assert.match(sidebar, /hash\.startsWith\("#fabrica"\)/);
  assert.doesNotMatch(dashboard, /hash === "#fabrica"/);
  assert.doesNotMatch(sidebar, /hash === "#fabrica"/);

  // Y el texto sin guardar avisa antes de perderse: ahora que el artículo
  // vuelve solo, una redacción que no vuelve se leería como dato comido.
  assert.match(fabrica, /window\.addEventListener\("beforeunload", avisar\)/);
});

test("una observacion no se edita ni se borra, ni siquiera la propia", async () => {
  const sql = await source("supabase/migrations/20260806_24_observaciones_articulo.sql");

  // Ninguna sesión escribe la tabla directamente: solo por RPC.
  assert.match(
    sql,
    /revoke insert, update, delete on public\.norma_observacion\s+from anon, authenticated, service_role;/,
    "alguna sesión conserva escritura directa sobre las observaciones",
  );
  assert.doesNotMatch(
    sql,
    /create policy[\s\S]{0,120}on public\.norma_observacion\s+for (insert|update|delete|all)/i,
    "no puede haber policy de escritura sobre las observaciones",
  );

  // El texto y la autoría son inmutables, y borrar está prohibido de plano.
  assert.match(sql, /before update or delete on public\.norma_observacion/);
  assert.match(sql, /if tg_op = 'DELETE' then\s+raise exception 'Una observacion no se borra/);
  assert.match(
    sql,
    /new\.texto is distinct from old\.texto[\s\S]{0,320}raise exception 'El texto y la autoria de una observacion son inmutables'/,
    "el trigger tiene que rechazar cualquier reescritura del texto o de la autoría",
  );
  // Reabrir una atendida borraría el rastro de que ya se había resuelto.
  assert.match(sql, /if old\.atendido_en is not null then\s+raise exception 'Una observacion ya atendida no se modifica'/);

  // El rol `consulta` escribe acá y solo acá: es una opinión, no un acto.
  assert.match(
    sql,
    /create or replace function public\.crear_observacion[\s\S]{0,900}if v_rol is null then/,
    "crear_observacion tiene que aceptar cualquier perfil reconocido, incluido consulta",
  );
  assert.doesNotMatch(
    sql,
    /create or replace function public\.crear_observacion[\s\S]{0,900}v_rol = any\(/,
    "crear_observacion no debe restringirse a los roles operativos",
  );

  // Atender es del administrador y exige fundamento, sin tocar el texto original.
  assert.match(
    sql,
    /create or replace function public\.atender_observacion[\s\S]{0,600}v_rol is distinct from 'administrador'/,
  );
  assert.match(
    sql,
    /create or replace function public\.atender_observacion[\s\S]{0,900}char_length\(btrim\(coalesce\(p_fundamento, ''\)\)\) < 12/,
  );
  assert.doesNotMatch(
    sql,
    /create or replace function public\.atender_observacion[\s\S]{0,900}set[\s\S]{0,200}texto\s*=/,
    "atender no puede reescribir el texto de la observación",
  );

  // La interfaz no ofrece editar ni borrar: solo agregar otra.
  const ui = await source("components/fabrica/observaciones-articulo.tsx");
  assert.doesNotMatch(ui, /editarObservacion|borrarObservacion|eliminarObservacion/);
  assert.match(ui, /No se puede editar: si querés corregirla, agregá otra/);

  // El agrupado por artículo respeta el orden y no se come las observaciones de
  // los artículos descartados: alguien opinó sobre ese texto igual.
  const { agruparObservaciones } = await import("../lib/norma-export.ts");
  const art = (id, orden, estado) => ({
    id, orden, estado, numero: orden, sumilla: `S${orden}`,
    texto: "Texto del artículo.", origen: "borrador_recibido",
    textoOriginal: null, aprobadoEn: null, actualizadoEn: "",
  });
  const obs = (articuloId, creadoEn, texto) => ({
    articuloId, texto, autorNombre: "Área X", autorRol: "consulta",
    creadoEn, atendidoEn: null, fundamento: null,
  });

  const filas = agruparObservaciones(
    [art("b", 2, "aprobado"), art("a", 1, "aprobado"), art("d", 3, "descartado")],
    [
      obs("d", "2026-08-03", "Sobre el descartado"),
      obs("b", "2026-08-02", "Segunda del dos"),
      obs("a", "2026-08-01", "Primera del uno"),
      obs("b", "2026-08-01", "Primera del dos"),
    ],
  );
  assert.deepEqual(
    filas.map((fila) => fila.observacion),
    ["Primera del uno", "Primera del dos", "Segunda del dos", "Sobre el descartado"],
    "las observaciones salen por orden de artículo y, dentro de cada uno, cronológicas",
  );
  assert.match(filas[3].articulo, /descartado/, "el descarte se declara, no se oculta");
  assert.equal(filas[0].estado, "Pendiente");

  // Una observación atendida viaja con su fundamento y el texto original intacto.
  const atendida = agruparObservaciones(
    [art("a", 1, "aprobado")],
    [{
      articuloId: "a", texto: "Texto original", autorNombre: "Área X", autorRol: "consulta",
      creadoEn: "2026-08-01", atendidoEn: "2026-08-05", fundamento: "Se incorporó al inciso b.",
    }],
  );
  assert.equal(atendida[0].observacion, "Texto original");
  assert.equal(atendida[0].estado, "Atendida");
  assert.equal(atendida[0].fundamento, "Se incorporó al inciso b.");

  // Un artículo sin observaciones no genera fila vacía.
  assert.equal(agruparObservaciones([art("a", 1, "aprobado")], []).length, 0);
});

test("las migraciones declaradas coinciden con los archivos reales", async () => {
  const { MIGRACIONES_DECLARADAS } = await import("../data/estado-sistema.ts");
  const archivos = (await readdir(new URL("../supabase/migrations/", import.meta.url)))
    .filter((archivo) => archivo.endsWith(".sql"))
    .sort();

  assert.deepEqual(
    MIGRACIONES_DECLARADAS.map((item) => item.archivo).sort(),
    archivos,
    "la pantalla de Seguridad declara migraciones que no coinciden con el repositorio",
  );
  // La numeración no puede repetirse ni saltear.
  const numeros = MIGRACIONES_DECLARADAS.map((item) => item.numero);
  assert.deepEqual(numeros, [...numeros].sort((a, b) => a - b));
  assert.equal(new Set(numeros).size, numeros.length, "hay números de migración repetidos");
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
