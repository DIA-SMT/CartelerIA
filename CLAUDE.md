# CartelerIA — contexto para agentes

Visualizador de cartelería urbana de la Municipalidad de San Miguel de Tucumán.
Next.js 16 (App Router) + Tailwind 3 + Supabase + Leaflet + RAG documental con
OCR propio. Todo en español (UI, comentarios, commits).

## Comandos

```bash
npm run dev                                # dev server (o .claude/launch.json "carteleria-dev")
npx tsc --noEmit                           # typecheck (strict, cero `any` — mantenerlo)
npm run test:workflow                      # gates administrativos y del motor
npx next build                             # build (First Load JS de / ≈ 202 kB — no engordarlo)
```

Existe un test específico del flujo administrativo (`npm run test:workflow`).
Todavía no hay una suite general ni configuración de ESLint.

## Arquitectura

- **Árbol 100% cliente**: `app/page.tsx` → `components/dashboard.tsx` (`"use client"`).
  No hay Server Components reales. `Dashboard` es el dueño del estado compartido
  (visor PDF, cartel seleccionado) y de `useTerritorialMap()`.
- **Datos territoriales**: `loadTerritorialLayers()` en `data/territorial.ts` hace
  `fetch` de `/data/*.json` (solo navegador). **No volver a importar esos JSON
  estáticamente**: se sacaron del bundle a propósito (~300 KB). Los scripts Node
  leen por `fs` y aplican `applyReviewBuffer` exportado.
- **Sesión**: `AuthProvider` único montado en `app/layout.tsx`
  (`components/auth-provider.tsx`). `hooks/use-auth.ts` es solo re-export para
  compatibilidad. No instanciar estado de auth en componentes.
- **Registro administrativo privado**: `loadCarteles(role)` solo se ejecuta con
  sesión y no tiene fallback estático. No importar `data/carteles.json` desde
  módulos cliente: contiene empresa, CUIT y padrón y terminaría en el bundle
  público. Sin sesión, el mapa usa únicamente las capas territoriales.
- **Permiso fiscal por rol** (`lib/roles.ts`, única fuente): `canSeeFiscalData`
  y `fiscalSource(tabla, rol)` deciden si se lee la tabla base o la vista
  `*_consulta` sin empresa/CUIT/padrón. El rol `consulta` no las ve por ninguna
  vía: tampoco puede filtrar ni agrupar por `empresa`/`empresaInspeccion` (los
  campos llevan `fiscal: true` y `parseQueryIntent` los corta), y las
  exportaciones XLSX/dossier reciben `includeFiscalData`. Un dato restringido se
  muestra con `<RestrictedByRole/>`, nunca vacío: el usuario debe distinguir
  "no hay dato" de "no tenés acceso".
- **Evidencia**: el navegador no firma URLs. `lib/evidence-access.ts` pide a
  `app/api/evidence/access` que autorice el lote; la RPC
  `autorizar_lectura_evidencia` resuelve rutas y registra el acceso en la MISMA
  transacción, así que si la auditoría falla no hay URL. La lectura directa de
  los buckets quedó revocada (las policies de INSERT siguen: el flujo
  reservar→upload→finalize depende de ellas). Cliente admin compartido en
  `lib/supabase-admin.ts` (las tres rutas anteriores todavía lo instancian
  inline: deuda conocida).
- **APIs** (`app/api/ask`, `app/api/normativa`): llaman a OpenRouter. Toda API
  nueva debe replicar sus defensas: rate limit por IP (`lib/rate-limit.ts`),
  límite de longitud del input, `AbortSignal.timeout`, y nunca filtrar
  `error.message` al cliente. `/api/ask` traduce la pregunta a un `QueryIntent`
  que SIEMPRE se revalida con `parseQueryIntent` (no confiar en el LLM).
- **Motion**: tokens en `tailwind.config.ts` (duraciones fast/DEFAULT/slow,
  easings `out`/`spring`, keyframes) + `prefers-reduced-motion` global en
  `globals.css`. Overlays montados condicionalmente animan salida con
  `hooks/use-dismissible.ts` (patrón `data-state`). Animar solo
  transform/opacity; el spotlight del tour ya se migró a transform — no
  reintroducir animación de top/left/width/height/box-shadow.
- **Sistema de UI compartido (usarlo, no reimplementarlo)**:
  `hooks/use-modal-shell.ts` (scroll lock apilado + focus trap donde solo el
  modal tope atrapa Tab + restitución de foco) para todo overlay nuevo;
  `components/confirm-dialog.tsx` para decisiones destructivas o con
  fundamento (nada de `window.confirm`; los Esc de padres en capture deben
  ceder con `confirmDialogIsOpen()`); `components/toaster.tsx` (`toast(...)`,
  evento `carteleria:toast`) para feedback de acciones; `components/ask-card.tsx`
  como cáscara de las consultas en lenguaje natural. Tipografía: piso de 10px
  con tokens `text-micro`/`text-tiny` y clase `.micro-label` — no volver a
  `text-[8px]`/`text-[9px]`. Estados con color dinámico: `.badge-soft`
  (fondo neutro + punto de color), nunca texto blanco sobre el color crudo.
  El contador de aprobaciones pendientes viaja por `APPROVALS_COUNT_EVENT`
  (`data/approvals.ts`) de la bandeja al header.

## Identidad visual (obligatoria)

Tokens `municipal` y `brandYellow` de `tailwind.config.ts`; logo
`public/logo-municipalidad-smt.png` sin recolorear ni deformar. Ver README.

## Supabase

- Migraciones idempotentes en `supabase/migrations/` (correrlas a mano en el SQL
  Editor; no hay CLI vinculado). `schema.sql` + seeds para setup desde cero.
- Seguridad (migración 11, aplicada y verificada): lectura de `carteles` exige sesión; escritura exige
  rol operativo via `tiene_rol`; `anon` no accede al registro administrativo y
  las cuentas nuevas nacen con rol `consulta`.
  No crear policies `to anon` de escritura ni defaults de rol altos.
- Flujo oficial (migración 12, aplicada y verificada): estados y vínculos cambian únicamente mediante
  RPC auditados; los roles operativos solicitan y el administrador resuelve con
  fundamento. No reintroducir `update({ estado })` directo ni borrado físico de
  inspecciones, fotografías o documentos.
- Endurecimiento (migraciones 13 y 14, aplicadas y verificadas): fuerza
  estados iniciales, impide actuaciones sin vínculo aprobado, devuelve los 13
  vínculos heredados a `pendiente` para ratificación administrativa, hace la
  evidencia `insert-only` con SHA-256, refuerza la bitácora inmutable y permite
  repostular vínculos rechazados. La cola global es exclusiva de
  administradores. El corpus RAG quedó reingerido con 15 documentos, 192 chunks
  y contrato atómico v1.
- Retrieval serverless (migración 15, aplicada y verificada): la ruta interactiva
  usa full-text search privado en PostgreSQL y superó los cinco probes del
  verificador. `@huggingface/transformers` queda solo en dependencias de
  desarrollo para ingesta offline; no volver a importarlo desde rutas Next.
- Gobernanza de identidades (migración 16, **escrita y pendiente de aplicación
  manual por Lucas**): los roles solo se cambian con la RPC `asignar_rol`
  (administrador humano, fundamento ≥12 caracteres, prohibido el auto-cambio,
  prohibido quedarse sin administradores, historial inmutable en
  `perfiles_historial`). `revoke` sobre `perfiles` + trigger
  `proteger_rol_perfiles` cierran el UPDATE directo, incluso a `service_role`.
  El rol `consulta` lee vistas `carteles_consulta`/`inspecciones_consulta`/
  `expedientes_consulta` sin datos personales ni tributarios. Las lecturas
  sensibles se registran en `acceso_datos_sensibles` (insert-only, solo
  administrador la lee). No reintroducir `update public.perfiles set rol = ...`
  a mano en el SQL Editor: el trigger lo rechaza y es a propósito. Tampoco
  borrar y reinsertar el perfil: un perfil nuevo solo nace con rol `consulta`.
- La lectura de los buckets quedó acotada al objeto propio, no revocada del
  todo: un `INSERT` con `RETURNING` también pasa por las policies de `SELECT` y
  sin ninguna se rompe la carga de evidencia. Si alguna vez se endurece más,
  probar un upload real — no lo cubren tsc, build ni tests.
- `service_role` es una identidad técnica: puede ejecutar mantenimiento
  autorizado, pero nunca debe registrarse ni interpretarse como aprobación
  legal. Las aprobaciones exigen un administrador humano y fundamento.
- La UI del flujo debe operar en modo *fail-closed*: ante errores de permisos,
  contexto o carga de aprobaciones, bloquear acciones y no inferir autorización.
  Al cambiar o cerrar sesión debe descartarse todo contexto administrativo
  privado.
- No habilitar actuaciones sobre los 13 vínculos heredados hasta que un
  administrador los ratifique individualmente con fundamento.
- `data/carteles.json` y los `seed*.sql` contienen datos personales: se guardan
  bajo `private/`, fuera de Git y Vercel. Los scripts que los procesan deben
  mantener esas rutas privadas.
- Indicadores (migración 17, **escrita y pendiente de aplicación manual**):
  `indicadores_gestion(...)` devuelve un `jsonb` con los 7 indicadores del
  roadmap, cada uno con `procedencia` y `suficiente`. El cálculo va en
  PostgreSQL: no replicarlo en el cliente ni traer el registro para contar. Un
  indicador sin datos suficientes se muestra "Sin datos", nunca como cero.
- Plan free: se pausa a los ~7 días sin actividad (el subdominio deja de
  resolver → parece error de DNS). Lo evita `.github/workflows/supabase-keepalive.yml`
  (ping diario; los `schedule` solo corren desde `main`; secrets `SUPABASE_URL`
  y `SUPABASE_ANON_KEY` — la anon key legacy `eyJ...` de 208 chars, no la
  `sb_publishable_...`).

## Flujo de trabajo

- Rama de trabajo `lucas` → push → Lucas mergea a `main` por PR en GitHub.
- Commits en español, estilo `feat(scope): resumen` (ver `git log`).
- Verificación mínima antes de commitear: `tsc --noEmit` + build si se tocó
  el bundle + `npm run test:workflow` si se tocó el flujo administrativo +
  `validate-query-counts` si se tocó el motor de consultas.

## Gotchas del entorno

- La pestaña del Browser pane corre oculta (`document.hidden: true`):
  screenshots y `requestAnimationFrame` se cuelgan. Peor aún desde Next 16:
  el renderer del pane directamente crashea al cargar la página de la app
  ("This page couldn't load"), aunque el server responda 200 y la página ande
  perfecta en un navegador real. Verificar con `curl`, `tsc`, tests y build;
  la pasada visual la hace Lucas en su navegador.
- StrictMode en dev duplica efectos: los fetch de capas se ven repetidos (en
  prod es uno por capa).
- `python` no existe en esta máquina (alias de Microsoft Store); usar `node -e`.
  `gh` CLI tampoco está instalado.

## Deuda conocida (priorizada, no urgente)

1. Ampliar los tests de integración y agregar CI de lint; las invariantes críticas
   del flujo administrativo y la privacidad del mapa ya tienen cobertura.
2. Monolitos con exceso de `useState`: `inspection-form` (542 líneas),
   `cartel-detail-panel` (502), `expediente-panel` (328) — candidatos a reducer.
3. Calibrar el recall de la búsqueda full-text con preguntas municipales reales
   y auditar periódicamente falsos rechazos.
4. `target: es5` en tsconfig y `as unknown as` sin validación de esquema donde
   entran los GeoJSON.
5. Mobile administrativo (paquete D, pospuesto a pedido de Lucas hasta que
   haya inspectores en la calle): tabla de expedientes → tarjetas en pantallas
   chicas y `pb-[env(safe-area-inset-bottom)]` en los bottom-sheets.
