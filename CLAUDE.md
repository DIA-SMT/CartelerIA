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
- **Navegación**: `components/app-sidebar.tsx` es el **único** punto de
  navegación, para todos los tamaños de pantalla. Ya no hay nav horizontal ni
  menú aparte para pantallas chicas. El cajón usa obligatoriamente
  `use-modal-shell` y `use-dismissible`; no reimplementar focus trap, scroll
  lock ni Escape. Se superpone al contenido y **no lo empuja**: es lo que evita
  que Leaflet recalcule tamaño y que el spotlight del tour se reposicione.
  El cajón se dibuja con `createPortal` sobre `document.body`, y es
  obligatorio: la barra superior tiene `backdrop-blur`, y un `backdrop-filter`
  convierte al elemento en bloque contenedor de sus descendientes
  `position: fixed`. Sin portal, el cajón queda encerrado en los 72px del
  header. **Mismo cuidado con cualquier overlay nuevo que se monte dentro de un
  contenedor con blur.**
  El sidebar es dueño de la lógica de rol de la nav y del único listener de
  `APPROVALS_COUNT_EVENT`. La escala de z-index del proyecto está documentada
  en ese archivo (el cajón va en 1050).
- **Configuración** (`components/configuracion/`, sección `#configuracion`):
  casa de la administración de identidades, solo rol administrador y cargada
  con `dynamic()` para no engordar el bundle inicial. Cinco pestañas con estado
  en la URL (`#configuracion?tab=...`): Usuarios, Roles y permisos, Auditoría,
  Seguridad y Corpus. No volver a crear una sección suelta de usuarios.
  La matriz de permisos se deriva de `PERMISSION_MATRIX` en `lib/roles.ts`, que
  usa las mismas constantes que aplican los permisos: si se desincroniza de
  `canSeeFiscalData`/`OPERATIVE_ROLES`, falla un test.
  En Seguridad, cada dato declara su origen (consultado en vivo, verificado a
  mano con fecha, o declarado en el repositorio). No presentar como comprobado
  lo que no se pudo consultar.
- **Fábrica Normativa** (`components/fabrica/`, sección `#fabrica`, migraciones
  20 a 24): mesa de redacción de la nueva ordenanza. Regla que gobierna todo el
  módulo: **la persona es la autora y el sistema asiste**, y eso se sostiene en
  PostgreSQL, no en la interfaz.
  - Nada se sobrescribe: `guardar_articulo` agrega una fila a
    `norma_articulo_version` con motivo obligatorio, y `texto_original` del
    borrador recibido es inmutable por trigger. No reintroducir un `update`
    directo sobre `norma_articulo.texto`.
  - El borrador (`doc-16`) tiene `estado_legal = 'proyecto'` y **nunca** es
    citable por el asistente normativo: `buscar_rag_chunks_lexico` exige
    `p_estados` explícito y no tiene default permisivo. Ojo:
    `sincronizar_documento_rag` escribe una lista fija de columnas y se come
    `estado_legal`; por eso existe `fijar_estado_legal_documento` (migración 22).
  - `norma_parametro` solo acepta un valor con cita **textual** del artículo
    (se valida con `position(cita in texto)`); un parámetro sin confirmar hace
    fallar la simulación en vez de asumir. `lib/norma-simulador.ts` es
    determinístico y no llama a ningún modelo: un dato faltante da
    `no_evaluable`, nunca `cumple`.
  - `/api/fabrica` propone y jamás escribe: no llama a ninguna RPC de
    articulado. Los hallazgos con cita que no se verifica contra los fragmentos
    (`lib/norma-citas.ts`) se descartan antes de guardarse.
  - **La búsqueda acepta `p_solo_ia_externa`** (migración 27) y `/api/fabrica`
    hace **dos** consultas en paralelo: la restringida es la que va al modelo, la
    general es la que se muestra. No es un lujo: la función corta en 8 filas
    *antes* de mirar quién puede salir, así que filtrar el resultado deja afuera
    justo lo que servía — medido, 2 de 5 consultas municipales típicas no
    recuperaban ni un fragmento habilitado. La firma tiene cuatro argumentos:
    `/api/normativa` y `scripts/verify-live-integrity.mjs` también la llaman.
  - **La salida hacia IA externa se decide documento por documento**
    (migración 26). Antes un solo fragmento restringido bloqueaba la consulta
    entera y, como la búsqueda recorre los 15 documentos vigentes, habilitar uno
    no servía de nada. Ahora el modelo recibe solo los fragmentos habilitados y
    los demás se muestran en pantalla. **Las citas se verifican contra
    `saneadosHabilitados`, no contra todos**: si no, una cita inventada que
    coincidiera con un fragmento retenido pasaría por verificada. El precio de
    filtrar es el falso negativo, así que la respuesta trae `visto` por
    fragmento y `FragmentosVigente` lo dice: un "sin hallazgos" que no aclara
    qué se miró es peor que no responder.
    Habilitar es un acto: `habilitar_documento_ia_externa` exige administrador
    humano y fundamento, queda en `auditoria_eventos`, y tiene dos barreras que
    no dependen de quién llame — nada `interno` y nada en estado `proyecto` sale,
    aunque se lo pida. Apagar siempre se puede, sin barreras.
  - La exportación para elevar es fail-closed (`evaluarElevacion`): un artículo
    sin aprobar o un diagnóstico grave sin atender la bloquean y se dice cuál.
    La versión de trabajo siempre está disponible y va marcada como borrador.
    Word se genera en el cliente con `docx` en import diferido; el PDF sale de
    `@media print`. Ni `docx` ni `write-excel-file` deben entrar al bundle
    inicial.
  - `norma_observacion` es el único lugar donde el rol `consulta` escribe, y
    escribe una opinión, no un acto administrativo. Insert-only: nadie edita ni
    borra, tampoco la propia — se agrega otra. El administrador la marca
    atendida con fundamento y el texto original queda intacto.
  - El lienzo (`lienzo-articulo.tsx`) va de una idea en lenguaje llano a un
    artículo. Esa idea **es** el motivo de la versión 1 (migración 25): sin eso
    un artículo de origen `asistente` queda sin rastro de qué pidió una persona.
    `origen` se declara `asistente` solo si el texto lo escribió la máquina; si
    lo escribiste vos, dice `redactado`. Sin IA el lienzo igual crea artículos a
    mano: se degrada la asistencia, no la herramienta.
  - El artículo abierto vive en el hash (`#fabrica?articulo=<id>`), igual que
    las pestañas de Configuración, y se escribe con `replaceState` — asignar
    `location.hash` scrollea a la sección y saca el foco del editor. Un id que
    no existe se limpia **recién** con `loadPhase === "ready"`: antes
    descartaría una selección válida solo por llegar primero.
- **Motion, detalle a saber**: el token `DEFAULT` (250ms) de
  `transitionDuration` **no tiene clase utilitaria** — ni `duration` ni
  `duration-DEFAULT` se generan. Los overlays usan `duration-200`; `duration-fast`
  y `duration-slow` sí existen.
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
  rol operativo via `tiene_rol`; `anon` no accede al registro administrativo.
  No crear policies `to anon` de escritura ni defaults de rol altos.
- **Las cuentas nuevas nacen con rol `consulta` (migración 18).** Ojo con esta:
  la 10 ya lo decía y el repo la reflejaba, pero la instancia real conservó la
  versión de la migración 07 —que insertaba `'administrador'`— hasta el
  2026-08-06. Se descubrió recién cuando el trigger de la 16 rechazó un alta.
  **Leer el archivo del repo no prueba nada sobre la base**: las migraciones se
  corren a mano y una puede quedar a medio aplicar sin dejar rastro. Ante una
  duda sobre una función, consultar `pg_proc.prosrc` en la instancia.
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
- Gobernanza de identidades (migración 16, aplicada y verificada): los roles
  solo se cambian con la RPC `asignar_rol`
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
- Indicadores (migración 17, aplicada y verificada):
  `indicadores_gestion(...)` devuelve un `jsonb` con los 7 indicadores del
  roadmap, cada uno con `procedencia` y `suficiente`. El cálculo va en
  PostgreSQL: no replicarlo en el cliente ni traer el registro para contar. Un
  indicador sin datos suficientes se muestra "Sin datos", nunca como cero.
- Fábrica Normativa (migraciones 20 a 24, todas aplicadas y verificadas contra
  la instancia el 2026-08-06): 29 comprobaciones, incluidos los cinco RPC del
  bloque 3, la columna `origen`, los 33 artículos sembrados, y que `service_role`
  reciba `42501` al intentar insertar, reescribir o borrar una observación.
  **La 28 está pendiente de aplicación** (no cambia la firma, así que no hay
  ventana de `PGRST202`: se puede aplicar antes o después de desplegar).
  Las **25, 26 y 27 están aplicadas y verificadas** (2026-08-06). La 27 subió el
  recall de 3 a 16 fragmentos habilitados sobre cinco consultas municipales
  típicas, y se comprobó que la búsqueda restringida devuelve **cero** fragmentos
  del borrador aun pidiendo `p_estados: ["proyecto"]` explícitamente.
  Nota de contenido, medida: ni el Decreto 0609/18 ni la Ordenanza 4728/2014
  regulan distancias a esquinas (cero menciones de "esquina", una de "ochava" en
  toda la 4728). Un artículo sobre eso es terreno nuevo, no un conflicto — si el
  asistente no devuelve hallazgos ahí, está en lo cierto.
  Verificaciones anteriores: 25 y 26 con 9
  comprobaciones: la sobrecarga vieja de `crear_articulo` de cuatro argumentos
  quedó efectivamente borrada, y `habilitar_documento_ia_externa` le responde a
  `service_role` con `permission denied for function` — el `revoke` lo frena al
  nivel del grant, antes del chequeo interno. El detalle de las reglas está
  arriba, en Arquitectura.
- **El `ocr_doubtful` de la máquina no es confiable en los dos sentidos.**
  `doc-02` (Decreto 0609/18) figura con OCR limpio y su texto indexado dice
  "TÍCULO 1*.-" y "hacla la Via Pública". La métrica de confianza del OCR no
  sirve como prueba de que el texto esté bien: por eso `human_reviewed` es una
  aserción de una persona y se pide leer los fragmentos antes de marcarla.
  Desde la migración 28, `ocr_doubtful` **no veta la salida**: la revisión
  humana, que ya es obligatoria, es la que contesta la duda. No se le agregó
  `or human_reviewed` al predicado porque sería una tautología que se lee como
  un guard y no guarda nada. La columna sigue existiendo y la pantalla la
  muestra al lado del "Revisado".
- **Corregir el OCR se hace sobre `data/ocr/<id>.json`, no sobre la base.** El
  ingest deriva los fragmentos de ese archivo, así que una corrección guardada
  solo en `rag_chunks` la pisa la próxima reingesta sin avisar — el mismo modo
  de falla que se comió el `estado_legal` del borrador. El editor
  (`components/configuracion/corregir-ocr.tsx`) abre el archivo del disco, lo
  edita contra el PDF y lo descarga; después va `npm run ingest:docs`. No toca
  Supabase por ningún lado, y hay un test que lo verifica.
  Dos campos son intocables al corregir: `sourceHash` (ata el texto a un PDF
  concreto; el ingest lo compara y descarta el archivo si no coincide) y
  `confianza` por página (es una medición del motor de OCR — editarla porque
  una persona corrigió el texto sería falsear una medida). Lo que se agrega es
  `corregidaPorHumano` y `correccionHumana`, que el ingest ignora.
  Al probar un RPC por PostgREST, ojo: si los nombres de los argumentos no
  coinciden exactos, devuelve `PGRST202` —el mismo código que si la función no
  existiera—. Verificar la firma antes de concluir que falta algo.
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
- **StrictMode está apagado** (`next.config.mjs`) porque react-leaflet 4.2.1 no
  soporta el doble montaje: dejaba el mapa a medio destruir y el overlay de
  error tapaba la pantalla en dev ("Map container is already initialized"). Solo
  afecta a dev; producción nunca duplicó efectos. Consecuencia: ya no se ven los
  fetch de capas repetidos, y tampoco se detectan efectos mal limpiados —
  revisar a mano las limpiezas de `useEffect` al escribir overlays nuevos.
  Reactivarlo al migrar a react-leaflet 5 (pide React 19).
- En el Browser pane, `requestAnimationFrame` NO dispara (`document.hidden`).
  Como `use-dismissible` abre con un rAF, **todo overlay se queda en su estado
  de salida** dentro del pane: el cajón aparece en `translateX(-100%)` y los
  telones en `opacity: 0`. No es un bug. Para verificar geometría, forzar el
  estilo por JS y medir; la animación la confirma Lucas en su navegador.
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
