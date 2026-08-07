# Contexto de arranque — paquetes E y F

> Generado el 2026-08-05 tras una lectura completa del proyecto. Complementa a
> `docs/prompt-paquete-E-F.md` (el plan) con el estado real del código: qué
> existe, dónde, y qué hay que tocar para cada ítem. Leer los dos antes de
> escribir la primera línea.

## Estado del repo al arrancar

- Rama `lucas`, limpia salvo `docs/prompt-paquete-E-F.md` (sin commitear).
  Último commit: `c86d418` (hero: chips con destino, stats asomando).
- Línea base verificada el 2026-08-05:
  - `npx tsc --noEmit` ✅
  - `npx next build` ✅ (Next 16.2.12 + Turbopack; rutas: `/`, `/api/ask`,
    `/api/normativa`, `/api/evidence/finalize`, `/api/cron/evidence-cleanup`.
    Turbopack ya no imprime First Load JS en el resumen del build; la
    referencia histórica de `/` es ~202 kB y la regla sigue siendo no engordarlo).
  - `npm run test:workflow` ✅ (11 tests, 11 pass, ~1.1 s; corre sin
    credenciales — ver sección de verificación).
- Migraciones 1–15 aplicadas y verificadas en Supabase. La 16
  (`20260806_16_gobernanza_identidades.sql`) es el corazón del paquete E y
  **la aplica Lucas a mano en el SQL Editor** (no hay CLI vinculado).

## Orden de ejecución acordado

1. **E1** roles auditados (tabla historial + RPC `asignar_rol` + cierre del
   camino directo + RPC `listar_perfiles`).
2. **E2** el rol `consulta` deja de ver empresa/CUIT/padrón (vista + policies
   + repositorio cliente por rol + UI "Restringido por rol" + motores de
   consulta).
3. **E3** auditoría de lectura de datos sensibles (tabla insert-only + RPC +
   `app/api/evidence/access/route.ts` fail-closed + revocar lectura directa
   del bucket).
4. **E4** panel de usuarios en la app (`components/usuarios-admin.tsx`,
   sección `#usuarios` solo administrador).
5. Verificación completa de E (tsc + test:workflow extendido + build) y
   actualización de `CLAUDE.md` + `docs/decisiones-y-roadmap.md`.
6. **F** recién después: RPC `indicadores_gestion` + sección de indicadores
   en el dashboard (los 7 del roadmap, calculados en PostgreSQL).

## Mapa del código por ítem

### E1 — Gobernanza de roles (lado SQL, mapeado)

**Lo que existe hoy:**

- Enum `public.app_rol` = `('administrador','coordinador','inspector','consulta')`
  y tabla `public.perfiles` (`user_id uuid PK → auth.users`, `rol` default
  `'consulta'`, `nombre text`, `created_at timestamptz`) — ambos en la
  migración 02 (`20260708_02_add_inspecciones.sql:17-32`). **No hay columna de
  email**: se lee de `auth.users`, por eso `listar_perfiles()` va
  `security definer` como anticipa el prompt.
- `public.tiene_rol(roles public.app_rol[]) returns boolean` — `stable`,
  `security definer`, `set search_path = public` (migración 02:38-51). Siempre
  se invoca con el cast `array[...]::public.app_rol[]`.
- Sobre `perfiles` hay **una sola policy y es de SELECT**
  (`perfiles_select_self`: self o administrador, 02:212-215). **Nunca hubo
  `revoke insert, update, delete on public.perfiles`** — hoy solo la ausencia
  de policy de escritura frena a `authenticated`; el revoke que pide el prompt
  es necesario, no redundante.
- El trigger vigente de alta (`handle_new_user`, versión de la migración 10)
  crea cuentas con rol `'consulta'` (verificado; la 07 que creaba
  `'administrador'` fue revertida). **Pero el UPDATE masivo de la 07 que
  ascendió a todos a administrador nunca se revirtió en datos** (la 10 lo dice
  explícito: "los roles ya asignados NO se tocan") — antes de confiar en la
  guarda "no dejar la instancia sin administradores", contar los admins reales.
- No existe `perfiles_historial` ni ninguna vista en todo el esquema.

**Patrones de la migración 13 a copiar (con líneas):**

- **Inmutabilidad**: `proteger_historial_legal_inmutable()` (13:1525-1534,
  `before update or delete`, mensaje propio) es la función para
  `perfiles_historial`; triggers modelo en 13:1629-1645. Siempre acompañada de
  `revoke insert, update, delete ... from anon, authenticated, service_role`
  **más `revoke truncate`** (13:1647-1672 — TRUNCATE no dispara triggers por
  fila ni se somete a RLS).
- **RPC modelo para `asignar_rol`**: `resolver_solicitud_cambio_estado`
  (13:1256-1393). Tres modismos textuales: (1) triple guarda de identidad
  `auth.uid() is null or coalesce(auth.role(),'') = 'service_role' or not
  tiene_rol(...)` — excluir `service_role` es deliberado; (2) validación de
  fundamento `char_length(btrim(coalesce(p_x,''))) < N` (acá N=12); (3)
  re-lectura del perfil para materializar `actor_nombre`/`actor_rol`
  desnormalizados. Cierre siempre con `revoke all ... from public` +
  `grant execute ... to authenticated` repitiendo la firma completa, y
  `comment on function` agrupados antes del `commit;`.
- **Variable de sesión para `proteger_rol_perfiles`**: el patrón real es
  `perform set_config('app.clave', valor, true)` (el `true` = `set local`) en
  el RPC y `coalesce(current_setting('app.clave', true), '')` en el trigger
  guardián (escritura 13:1373-1374, lectura 13:1561-1565). **El marcador solo
  no alcanza**: el trigger modelo valida además identidad administradora
  no-service_role, el ID exacto bloqueado y que las demás columnas queden
  intactas (13:1540-1611). Claves ya usadas (no reutilizar):
  `app.flujo_vinculo`, `app.aprobacion_estado`, `app.flujo_solicitud_estado`,
  `app.finalizacion_evidencia`, `app.evidencia_ticket_id`. Sugerida:
  `app.asignacion_rol`.
- **Historial en la misma transacción**: update + insert de historial
  consecutivos dentro del mismo `begin...end` (patrón en 13:1185-1216).
- **Molde de tabla**: `inspeccion_historial` (02:147-155;
  `estado_anterior/estado_nuevo` ↔ `rol_anterior/rol_nuevo`) + la tripleta
  `actor_id/actor_nombre/actor_rol` de `auditoria_eventos` (12:690-701).
  Lectura solo administrador, como `auditoria_eventos_select_admin`
  (12:707-710).
- **Estilo del archivo**: caja de `=` de 78 chars, ASCII sin tildes
  (`migracion`, `auditoria`), todo entre `begin;`/`commit;`, secciones
  numeradas con párrafo del *porqué*, comentarios inline solo para decisiones.

**Decisión a levantar antes de escribir la 16**: el prompt pide columna
`creado_en`, pero todo el esquema usa `created_at` (las cuatro tablas de
historial existentes incluidas). Elegir una y ser consistente.

### E2 — Privacidad consultiva (lado cliente, mapeado)

**Contrato de auth actual** (`components/auth-provider.tsx:13-28`): el contexto
expone `available / loading / user / role / roleError / canRead / canInspect /
error / retryRole / signIn / signOut`. **No existe `canWrite` global ni ninguna
granularidad de lectura**: un rol `consulta` tiene `canRead === true` y hoy ve
todo el registro. Los checks de rol privilegiado se hacen ad hoc comparando el
string (`approval-inbox.tsx:39`, `expediente-panel.tsx:63-64`,
`cartel-detail-panel.tsx:564-565`, `header.tsx:39`) — al implementar E2
conviene centralizar un flag tipo `canSeeFiscal` en `AuthState` en lugar de
repetir comparaciones. El rol se obtiene con `select("rol")` directo a
`perfiles` (`auth-provider.tsx:30-43`), patrón replicado server-side en
`app/api/normativa/route.ts:121-132`. Fail-closed ya resuelto: `canRead` cae
ante cualquier error, con guarda anti-carrera por `sessionSequence` y limpieza
de datos por patrón *owner id* en cada consumidor
(`use-territorial-map.ts:70-95`, `map-ask.tsx:58-75`).

**Los 5 puntos load-bearing del cambio:**

1. `lib/cartel-repository.ts:67` — `loadCarteles()` hace **`select("*")`** sin
   proyección y castea `data as CartelRow[]`. `CartelRow` (`:5-14`) declara
   `empresa`, `cuit`, `padron_cisi` como `string` **no opcionales**; el tipo de
   dominio es `CartelRecord` (`data/carteles.ts:6-31`, sensibles en `:11`,
   `:12`, `:19`). Acá va la elección de fuente por rol (tabla vs vista
   `carteles_consulta`) y el aflojado de tipos a opcionales.
2. `lib/territorial-cartel-linker.ts:60-67` — copia `empresa`, `cuit` y
   `padronCisi` dentro de `properties.administrative` de las features del mapa
   (solo para vínculos aprobados; los no aprobados llevan la versión mínima
   `{recordId, linkStatus}`).
3. `components/cartel-detail-panel.tsx:367` — `SummaryTab` con DataCards de
   Empresa y **CUIT (único render de CUIT en toda la UI)**, sin ningún check de
   rol. Empresa también en `:546` (inspecciones), `expediente-panel.tsx:325`,
   `expedientes-registro.tsx:98-109` (columna de la tabla) y
   `approval-inbox.tsx:194,226` (ya gateada a administrador). **`padronCisi`
   viaja al cliente pero ningún componente lo renderiza hoy.** Acá va el badge
   `Restringido por rol` con `.badge-soft`.
4. **Motores de consulta** — el campo `empresa` de carteles ya está
   deshabilitado en el intent (`data/map-query.ts:140`, `available: false`,
   cortado por `parsePredicate:218` y `parseQueryIntent:308`), **pero
   `empresaInspeccion` (`:152`) está habilitado** para filtrar y agrupar: el
   ranking "¿Qué empresa tiene más observaciones?" es un ejemplo literal de la
   UI (`map-ask.tsx:35`) y sale por `inspection-query-engine.ts:81` con la
   razón social en texto libre. Además `QueryResultItem.empresa` **se puebla
   siempre** (`map-query-engine.ts:113`) y se pinta en `map-ask.tsx:223` en
   cualquier listado de carteles. CUIT y padrón no llegan a ningún texto.
   `lib/map-query-ai.ts` no tiene red: delega en las reglas locales.
5. **Exportación (fuga que el prompt no menciona):**
   `lib/expediente-report.ts:142` (HTML del informe) y `:203` (columna del
   XLSX) incluyen empresa, disparado desde `expedientes-registro.tsx:62-76` —
   hoy accesible para cualquier `canRead`, incluido `consulta`. Hay que
   gatearlo o redactarlo por rol.

Para el test extendido: `lib/external-ai-policy.ts` ya trae detectores de
`cuit_cuil` (`:21-27`) y `padron` (`:53-55`) reutilizables como oráculos.

**Lado SQL de E2 (mapeado):**

- La policy vigente es `carteles_authenticated_read` en la **migración 13**
  (13:1412-1419), no en la 11: exige `tiene_rol` con los 4 roles del enum. El
  mismo bloque (13:1421-1509) aplica la cláusula idéntica a otras 10 tablas —
  las once que menciona el prompt.
- `public.carteles` tiene 31 columnas (25 de `schema.sql:1-26` + 6 de vínculo
  de la 12:494-500). `empresa`, `cuit` y `padron_cisi` son
  `text not null default ''` — **no admiten NULL**, así que la vista
  `carteles_consulta` que los omite es más limpia que enmascararlos. Otras
  columnas a evaluar para la vista: `domicilio`, `numero`, `google_maps_url`,
  `street_view_image_url`, coordenadas originales, y los uuid
  `vinculo_solicitado_por`/`vinculo_aprobado_por` (identidades de agentes).
- **La vista sola NO cierra E2** — `empresa`/`cuit` están duplicados en
  `inspecciones` (02:109-110) y `empresa` en `expedientes` (06:60), ambas
  legibles hoy por `consulta` con la misma cláusula. `auditoria_eventos`
  (que guarda filas completas en jsonb) ya está cerrada a administrador
  (12:707-710). Hay que restringir también la lectura de `inspecciones` y
  `expedientes` para `consulta` (o vistas equivalentes), si no la
  verificación nº 5 del prompt falla por esa vía.
- `expediente_documentos` e `inspeccion_fotos` **no tienen datos personales en
  columnas** (solo `created_by` de agentes; el dato real está en el binario →
  se cierra por Storage en E3). Único matiz: `descripcion` es texto libre de
  hasta 500 chars donde un inspector podría tipear un CUIT. Aplica la salida
  "dejarlas como están y anotarlo" que el propio prompt habilita.

**Dónde se firma hoy (exactamente 2 puntos, ambos en el navegador):**

| Punto | Bucket | TTL | Call sites |
|---|---|---|---|
| `lib/inspection-repository.ts:188-190` (`loadInspectionPhotos`) | `inspeccion-fotos` | 3600 s | `cartel-detail-panel.tsx:465`, `inspection-form.tsx:112` |
| `lib/expediente-repository.ts:189-191` (`loadExpedienteDocumentos`) | `expediente-docs` | 3600 s | `expediente-panel.tsx:117` |

Ambos usan `createSignedUrls` batch todo-o-nada y devuelven `url` dentro de
`InspectionPhoto` / `ExpedienteDocumento`; el render es `<img>` + lightbox
(`cartel-detail-panel.tsx:589-618`, `inspection-form.tsx:338-346`) y un
`<a target="_blank">` (`expediente-panel.tsx:359`). `pdf-library`/`pdf-viewer`
usan PDFs estáticos de `/public`, fuera de alcance.

**Estado de Storage:** dos buckets privados (`inspeccion-fotos` 10 MB
`image/*`; `expediente-docs` 10 MB `pdf`+`image/*`). Las policies de lectura
**vigentes** están en el bloque tardío de la migración 13
(`inspeccion_fotos_read` 13:3098-3114, `expediente_docs_read` 13:3116-3132 —
ojo: la 13 las define dos veces, la de 13:2065-2077 quedó sobrescrita):
`select to authenticated` con `tiene_rol` de los 4 roles + objeto manifestado
en la tabla de evidencia u `owner_id` propio. O sea: **cualquier autenticado,
incluido `consulta`, puede firmar URLs hoy.** Para E3: dropear esas dos
policies **por nombre y sin recrearlas** (`service_role` bypassea RLS de
`storage.objects`, la API firma igual), pero **conservar el INSERT**
(`inspeccion_fotos_insert` 13:3080-3096 con `puede_subir_evidencia`): el flujo
de carga reserva→upload→finalize depende de él. UPDATE/DELETE ya no existen.
**No existe hoy ninguna tabla ni registro de auditoría de acceso a
evidencia.**

**Patrón server-side a copiar** para `app/api/evidence/access/route.ts`:

- Sesión por header `Authorization: Bearer <access_token>` →
  `admin.auth.getUser(token)` → autorización fina delegada a una RPC de
  PostgreSQL: es exactamente `app/api/evidence/finalize/route.ts:143-174`.
  El check de rol contra `perfiles` está en `normativa/route.ts:121-132`.
- El access token del cliente sale de `supabase.auth.getSession()` (patrón en
  `lib/evidence-finalizer.ts:106-133`, con reintentos y backoff).
- **No hay helper de admin client**: el `createClient(url, SERVICE_ROLE_KEY)`
  está copiado inline en 3 rutas (`finalize:158`, `cleanup:47`,
  `normativa:110`). Extraer `lib/supabase-admin.ts` como parte de E3.
- Rate limit: `/api/ask` usa `lib/rate-limit.ts` (memoria, por IP:
  `rateLimit(key, limit, windowMs)` + `clientIp(request)`), pero para un
  endpoint **autenticado** el patrón superior ya existe: cuota distribuida en
  DB vía RPC `consumir_cuota_api` (`normativa/route.ts:134-158`), que no
  depende de memoria de instancia. Usar la cuota DB y sumar el limiter de
  memoria como primera barrera barata si se quiere.
- Resto de defensas de `normativa`: límite de 500 chars, validación de
  contrato de la RPC con type-guard, `AbortSignal.timeout`, errores opacos
  (`console.error` con detalle, cliente recibe solo códigos), y
  `Cache-Control: no-store` (patrón de `finalize:33-39`).

**Observación colateral:** `/api/ask` quedó muerto en la práctica (el cliente
interpreta local con `interpretQuestionSmart`) y sigue expuesto sin
autenticación. Devuelve solo `{intent, source}` — sin datos sensibles — pero
vale decidir si se elimina o se le agrega auth en este tramo.

### E4 — Panel de usuarios (mapeado)

**Nav del header** (`components/header.tsx:35-42`): la nav se arma con spreads
condicionales sobre `baseNavigation`; `#aprobaciones` entra con
`auth.canRead && auth.role === "administrador"` y badge de
`APPROVALS_COUNT_EVENT` (`CustomEvent<number>`, listener en `:28-33`).
`#usuarios` es un tercer spread idéntico. El array alimenta la nav desktop y
la mobile a la vez. `NavBadge` (`:110-118`) ya existe si se quiere contador.
**Cuidado**: `tests/workflow-invariants.test.mjs:203-204` hace asserts regex
sobre `header.tsx` (prohíbe reintroducir Buscar/Notificaciones/Avisos) —
correr `test:workflow` tras tocarlo.

**Modelo de sección completo**: `components/approval-inbox.tsx` es el molde a
imitar pieza por pieza — guard `isAdmin` + `return null` (`:39`, `:103`),
máquina `LoadPhase = idle|loading|ready|error` (`:31`), anti-carrera con
`refreshSequence` + `dataOwnerId` + `ownsData` (skeleton si los datos no son
de la sesión actual, `:47-58`, `:104`, `:168`), doble paso de resolución
(click valida y abre `ConfirmDialog`; la mutación corre en un
`executeResolution` con guarda de idempotencia `resolvingIds`), post-éxito
`toast(...)` + `refresh()`, layout `section-block`/`section-heading`, skeleton
×2 / banner `role="alert"` / empty-state. El contrato de carga es
`LoadResult<T> = {ok,data,error}` de `data/approvals.ts:14-16` — reusarlo para
`listar_perfiles()`. Para el historial por usuario, el molde liviano es
`components/state-change-approvals.tsx` (recibe todo por props, lista
pendientes + últimos 5 resueltos).

**APIs exactas del sistema compartido:**

- `useModalShell(containerRef: RefObject<HTMLElement | null>): void` — sin
  opciones. Scroll lock apilado, foco inicial, Tab atrapado solo en el modal
  tope, restitución de foco. **Escape NO lo maneja**: responsabilidad del
  componente.
- `ConfirmDialog` props: `{title, description, quote?, tone:
  "approve"|"reject"|"discard", confirmLabel, cancelLabel?, onConfirm,
  onCancel}`. Se monta condicionalmente desde el padre (no hay provider). El
  `quote` renderiza el fundamento tipeado como blockquote. Foco inicial en
  Cancelar. `confirmDialogIsOpen()` es un contador de módulo: todo Escape de
  padre en capture debe abrir con `if (confirmDialogIsOpen()) return;`.
- `toast(message: string, tone: "success"|"error"|"info" = "success")` —
  despacha el evento; `<Toaster/>` ya está montado una sola vez en
  `dashboard.tsx:70`, no volver a montarlo.
- `useDismissible(onClose, duration = 220): {open, close}` — `open` a
  `data-state`, `close` en todos los cierres.

**Tabla**: la única tabla real del árbol es
`components/expedientes-registro.tsx:93-117` (wrapper `overflow-x-auto` +
`min-w-[640px]`, filas `border-t`, fechas `toLocaleDateString("es-AR")`,
estado `.badge-soft` con `<i style={{background}}/>`). Es el molde, **pero no
heredar sus `text-[9px]`/`text-[11px]`** (violan el piso tipográfico): usar
`text-tiny` en celdas y `text-micro`/`.micro-label` en el thead. Copiar
también su `TableSkeleton` (`:122-129`) y, literal, la **cascada fail-closed
de render** (`:80-92`): `!auth.user → null` → `!canRead → (roleError ?
empty-state rojo con retryRole : skeleton)` → `!ownsData || loading →
skeleton` → `error → empty-state rojo` → `vacío → empty-state neutro` → tabla.

**Ubicación**: el "bloque de gestión contiguo" del dashboard
(`dashboard.tsx:58-64`) — `#usuarios` va junto a `#aprobaciones` y
`#expedientes`. Los ids de sección viven en cada componente hijo
(`<section id="usuarios" className="section-block">`).

### F — Indicadores de gestión (mapeado)

**Lo que hay hoy**: `components/stats-cards.tsx` son 24 líneas con 4 tarjetas
descriptivas — Documentos cargados (2, constante del catálogo estático),
Carteles identificados y Corredores (props de `useTerritorialMap`, `—` si
loading), Categorías normativas (1, constante). Sin `id` de sección, montadas
dentro del bloque del hero con `-mt-5` (`dashboard.tsx:54`). **Ninguno de los
7 indicadores existe.** Dato útil: `useTerritorialMap` ya expone
`linkedCount` (numerador de cobertura territorial), pero F pide calcular en
PostgreSQL, no en el cliente.

**Orden actual de secciones del dashboard** (ids en los hijos): `#inicio`
(hero) → stats → `#mapa` → `#aprobaciones` → `#expedientes` → `#carteles` →
`#normativa` (único id en `dashboard.tsx:63`) → `#documentos` → `#corredores`.
La sección `#indicadores` encaja natural en el bloque de gestión.

**Modelo SQL**: no existe hoy ningún RPC con parámetros de fecha — se escribe
de cero. El mejor modelo estructural es `buscar_rag_chunks_lexico`
(15:70-220): `drop function if exists` con firma completa antes de recrear,
`returns table (...)` explícito, defaults en los últimos parámetros, y un
**CTE `entrada` de saneamiento** como primer paso
(`least(greatest(coalesce(p_match_count,8),1),8)` — el modismo para clampear
fechas/zona). Cierre `revoke all from public, anon` + `grant execute` +
`comment on function`. Para `returns table` con `plpgsql` + guarda de rol:
`reclamar_cargas_huerfanas` (13:2637-2653); para normalización de parámetros
en `declare` + regex: `reservar_carga_evidencia` (13:2815-2865).

**Decisión de diseño E2↔F que el prompt no explicita**: tras E2, `consulta`
pierde la lectura de `carteles` base. Un RPC `security invoker` le devolvería
vacío/error para todo indicador que agregue sobre `carteles`. Opciones: (a)
`security definer` con guarda de rol y segmentación restringida por rol
adentro del RPC (para que `consulta` no segmente por empresa, como exige el
prompt), o (b) computar sobre la vista `carteles_consulta`. Decidirlo antes
de escribir el RPC.

**Colateral**: `components/zone-ranking.tsx` es código muerto (nadie lo
importa, datos hardcodeados/simulados) — no revivirlo para indicadores;
candidato a borrarse en este tramo.

## Cómo verificar (y cómo extender los tests)

- `npm run test:workflow` = `node --experimental-strip-types --test
  tests/workflow-invariants.test.mjs tests/map-query-privacy.test.mjs`
  (`package.json:12`). Runner `node:test` nativo, **sin credenciales ni
  Supabase vivo**: los tests validan contratos leyendo las fuentes (regex
  sobre las migraciones SQL y sobre componentes) e importando los módulos
  `.ts` reales (strip-types; `map-query.ts` se transpila en memoria con el
  paquete `typescript` y un `require` sandbox). El warning
  `MODULE_TYPELESS_PACKAGE_JSON` es benigno.
- Las 6 invariantes nuevas que pide el prompt para E se escriben en el mismo
  estilo: asserts de regex sobre `20260806_16_gobernanza_identidades.sql`
  (fundamento mínimo, prohibición de auto-cambio, guarda de último
  administrador, revoke sobre `perfiles`, trigger guardián) + asserts sobre
  los módulos TS para la privacidad consultiva. Para la invariante nº 5
  ("consulta no obtiene empresa/cuit/padrón por ninguna vía") los vectores
  concretos a cubrir son: `empresaInspeccion` en el QueryIntent,
  `QueryResultItem.empresa`, y la exportación XLSX/HTML de expedientes.
- `scripts/verify-live-integrity.mjs` (`npm run verify:live-integrity`) es
  aparte: ese sí toca la base viva con `SUPABASE_SERVICE_ROLE_KEY`, y es el
  candidato natural para probes post-aplicación de la 16.
- Otros tests hacen asserts que pueden romperse con cambios legítimos de este
  tramo: sobre `header.tsx` (nada de Buscar/Notificaciones), sobre
  `package.json` (`@huggingface/transformers` exactamente `^4.2.0` y solo en
  devDependencies), y sobre la existencia exacta de los 2 PDFs públicos.
- No hay ESLint ni CI de lint; typecheck a mano con `npx tsc --noEmit`
  (`strict`, `target: es5`, alias `@/*`).

## Sorpresas y riesgos que el prompt no menciona (priorizado)

1. **E2 no se cierra con la vista `carteles_consulta` sola**: `empresa`/`cuit`
   duplicados en `inspecciones` y `expedientes` (legibles por `consulta`), el
   ranking por `empresaInspeccion` habilitado en "Preguntale al mapa",
   `QueryResultItem.empresa` poblado en todo listado, y la exportación
   XLSX/HTML de expedientes. Todos son vías de fuga activas para una sesión
   consultiva.
2. **Interacción E2↔F**: restringir la lectura de `carteles` cambia qué puede
   agregar un RPC `security invoker` para `consulta` (ver decisión en F).
3. **Residuo de la migración 07**: el ascenso masivo a `administrador` nunca
   se revirtió en datos. Puede haber más administradores reales que los
   esperados; revisarlo con el panel nuevo (o un select) apenas exista.
4. **`created_at` vs `creado_en`**: el prompt pide `creado_en`; todo el
   esquema usa `created_at`. Decidir al escribir la 16.
5. **Policies de Storage**: las vigentes son las del bloque tardío de la 13
   (3098-3132). Dropear por nombre, no recrear lectura, conservar INSERT.
6. **Tipos TS de carteles**: `CartelRow` declara los campos sensibles como
   `string` no opcionales y hay casts `as` sin validación — E2 obliga a
   volverlos opcionales y es la oportunidad de ordenar eso.
7. **`AuthState` sin granularidad de lectura**: los checks de rol se repiten
   como comparación de string en 4+ componentes. Centralizar un flag (p. ej.
   `canSeeFiscal`) en el provider al implementar E2.
8. **No hay helper de admin client**: `createClient(url, SERVICE_ROLE_KEY)`
   está copiado inline en 3 rutas. Extraer `lib/supabase-admin.ts` en E3.
9. **`/api/ask` quedó muerto y sin auth**: el cliente interpreta local. No
   expone datos sensibles, pero decidir si se elimina o se autentica.
10. **`tailwind.config.ts` → `content`** solo cubre `./app/**` y
    `./components/**`: si algún archivo nuevo de UI queda fuera de esas
    carpetas, sus clases no se generan.

## Reglas que no se negocian (resumen operativo)

- Todo en español; commits `feat(scope): resumen`; rama `lucas` → PR a `main`.
- `tsc --noEmit` estricto con cero `any`; no engordar el bundle de `/`.
- Fail-closed en toda la UI administrativa: ante error de permisos/contexto,
  bloquear y no inferir autorización.
- Nada de `update({ estado })` directo, borrado físico ni policies `to anon`
  de escritura. Los RPC nuevos replican el estilo de la migración 13.
- APIs nuevas replican las defensas de `/api/ask`: rate limit por IP, límite
  de input, `AbortSignal.timeout`, nunca filtrar `error.message`.
- UI nueva usa el sistema compartido: `use-modal-shell`, `confirm-dialog`
  (nada de `window.confirm`), `toast(...)`, `.badge-soft`, `text-micro`/
  `text-tiny`, tokens de motion (solo transform/opacity,
  `prefers-reduced-motion`).
- La pasada visual la hace Lucas en su navegador (el Browser pane crashea con
  Next 16). Verificar con `tsc`, tests, build y `curl`.
- Ningún dato simulado puede presentarse como situación administrativa real;
  un indicador sin datos suficientes se muestra como tal, no como cero.

## Fuera de alcance (decidido, no reabrir)

- Paquete D (mobile administrativo) y flujo offline: pospuestos hasta que
  haya inspectores en la calle.
- Ratificación de los 13 vínculos heredados: tarea administrativa de Lucas
  desde la bandeja, no de código.
- Auditoría versionada de respuestas normativas: próximo paquete grande,
  fuera de la presentación.
- Purga de PDF/OCR del historial de Git: coordinado, previo a publicar el repo.

## Pendientes manuales de Lucas (fuera del código)

- Aplicar la migración 16 en el SQL Editor cuando esté lista (quedará anotado
  también en el roadmap).
- Verificar si siguen abiertos: cambio de contraseña de `direcciona@smt.gob.ar`
  y confirmación de que el signup público sigue deshabilitado.
- Ratificar los 13 vínculos heredados desde la bandeja de aprobaciones.
