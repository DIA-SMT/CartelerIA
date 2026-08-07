# CartelerIA — Prompt para el próximo tramo (paquetes E y F)

> Pegar en Claude Code, en la raíz del proyecto, rama `lucas`.
> Objetivo declarado: dejar el sistema presentable ante autoridades, con la
> gobernanza de identidades y la privacidad consultiva resueltas de verdad
> (en PostgreSQL, no en React).
> Ejecutar **paquete E completo antes** de empezar el F.

---

## Contexto que ya es cierto (no re-verificar ni rehacer)

Leé `CLAUDE.md` y `docs/decisiones-y-roadmap.md` antes de tocar nada. Resumen:

- Migraciones 1 a 15 aplicadas y verificadas en Supabase. Las migraciones se
  corren a mano en el SQL Editor: **no hay CLI vinculado**. Toda migración nueva
  debe ser idempotente y auto-contenida.
- El flujo administrativo ya es fail-closed, auditado e insert-only. No
  reintroducir `update({ estado })` directo, borrado físico, ni policies de
  escritura `to anon`.
- Todo en español: UI, comentarios y commits (`feat(scope): resumen`).
- `npx tsc --noEmit` en strict y con cero `any`. Mantenerlo.
- La pasada visual la hace Lucas en su navegador: el Browser pane crashea con
  Next 16. Verificá con `tsc`, `npm run test:workflow`, `next build` y `curl`.

---

# PAQUETE E — Gobernanza de identidades y privacidad consultiva

Cuatro problemas a cerrar, en este orden. Todo lo de base va en una única
migración nueva **`supabase/migrations/20260806_16_gobernanza_identidades.sql`**,
idempotente, con el mismo estilo de comentarios que la 13.

## E1 · Asignación de roles auditada

Hoy los roles se cambian con un `update public.perfiles set rol = ...` a mano en
el SQL Editor. Es la acción más sensible del sistema y la única sin fundamento
ni traza, en un proyecto donde todo lo demás exige ambas cosas.

Implementar:

1. **Tabla `public.perfiles_historial`**, inmutable, con: `id`, `user_id`
   afectado, `rol_anterior`, `rol_nuevo`, `fundamento`, `actor_id`,
   `actor_nombre`, `actor_rol`, `creado_en`. Protegerla con los mismos triggers
   de no-delete / no-update que ya usa la migración 13 para la bitácora legal, y
   revocar `insert, update, delete, truncate` a `anon`, `authenticated` y
   `service_role`.

2. **RPC `public.asignar_rol(p_user_id uuid, p_rol public.app_rol, p_fundamento text)`**,
   `security definer`, `set search_path = public`, con estas guardas —cada una
   con su propio mensaje de error:
   - exige `tiene_rol(array['administrador'])`;
   - exige fundamento con al menos 12 caracteres después de `trim`;
   - **prohíbe cambiar el propio rol** (`auth.uid() = p_user_id`);
   - **prohíbe dejar la instancia sin administradores**: si el afectado es
     administrador y no queda ningún otro, rechazar;
   - es no-op silencioso si el rol no cambia (no ensucia el historial);
   - registra en `perfiles_historial` en la misma transacción.
   Terminar con `revoke all ... from public` + `grant execute ... to authenticated`,
   igual que los RPC de la 13.

3. **Cerrar el camino directo**: `revoke insert, update, delete on public.perfiles
   from anon, authenticated;` más un trigger `proteger_rol_perfiles` que rechace
   cualquier UPDATE de la columna `rol` que no venga del RPC (usá un
   `set local` de variable de sesión dentro de `asignar_rol` y comprobalo con
   `current_setting(..., true)`). El objetivo es que ni un `service_role`
   distraído pueda mover un rol sin dejar fundamento.

4. **RPC `public.listar_perfiles()`**, solo administrador, que devuelva
   `user_id`, `nombre`, email (leído de `auth.users`, por eso `security definer`),
   `rol`, `creado_en` y la fecha del último cambio de rol. Es la fuente del panel.

## E2 · El rol `consulta` deja de ver datos personales y tributarios

Decisión tomada: una cuenta consultiva **no** debe ver `empresa`, `cuit` ni
`padron_cisi`. Hoy la migración 13 le da a `consulta` exactamente la misma
cláusula `using` que al administrador en once tablas.

1. Crear la vista **`public.carteles_consulta`** con todas las columnas de
   `public.carteles` **excepto** `empresa`, `cuit` y `padron_cisi`.
2. Restringir `carteles_authenticated_read` a
   `['administrador','coordinador','inspector']` y otorgar la vista al rol
   `consulta` (más los operativos, para no romper nada).
3. Hacer lo propio con la lectura de `expediente_documentos` y
   `inspeccion_fotos` **solo si** exponen datos personales en columnas; si no,
   dejarlas como están y anotarlo.

**Lado cliente — esta es la parte delicada:**

- `lib/cartel-repository.ts` hoy hace `select` sobre `carteles`. Con la nueva
  policy, una sesión `consulta` recibiría un error de permisos y la app entraría
  en fail-closed en lugar de mostrar el mapa. Hacé que el repositorio elija la
  fuente según el rol de la sesión, y que el tipo TS refleje los campos ausentes
  como opcionales/`null` en vez de castear.
- En la UI, un campo restringido **no se muestra vacío**: se muestra como
  `Restringido por rol` con el patrón `.badge-soft`. Que el usuario entienda que
  el dato existe y él no lo ve, en lugar de creer que falta el dato.
- Revisá que `lib/map-query-engine.ts`, `lib/inspection-query-engine.ts` y
  "Preguntale al mapa" no filtren empresa o CUIT en agregados o respuestas de
  texto para una sesión `consulta`. `tests/map-query-privacy.test.mjs` ya cubre
  la privacidad del mapa: **extendelo** con el caso del rol consultivo.

## E3 · Auditoría de lectura de datos sensibles

Las escrituras tienen bitácora inmutable; las lecturas no dejan rastro. Nadie
puede saber quién consultó un CUIT ni quién descargó una fotografía.

1. **Tabla `public.acceso_datos_sensibles`**, insert-only e inmutable:
   `id`, `actor_id`, `actor_rol`, `recurso` (`cartel_datos_fiscales` |
   `inspeccion_foto` | `expediente_documento`), `recurso_id`, `motivo` (opcional),
   `creado_en`. Lectura reservada al administrador.
2. **RPC `public.registrar_acceso_sensible(...)`** como única vía de escritura.
3. **La evidencia se audita del lado del servidor, no del cliente.** Hoy las
   fotografías y documentos se sirven con signed URLs pedidas desde el navegador:
   auditar ahí sería trivialmente evitable. Creá
   **`app/api/evidence/access/route.ts`** que verifique la sesión y el rol,
   registre el acceso y **recién entonces** devuelva la signed URL usando
   `service_role`; después revocá la lectura directa del bucket a
   `authenticated`. Si el registro de auditoría falla, **no se entrega la URL**
   (fail-closed). La ruta debe replicar las defensas de `/api/ask` y
   `/api/normativa`: rate limit por IP, límite de input, `AbortSignal.timeout` y
   nunca filtrar `error.message`.
4. Para la apertura de una ficha con datos fiscales, registrar el acceso sin
   bloquear la vista, pero mostrar el fallo si no se pudo auditar.

## E4 · Panel de usuarios en la aplicación

Para que administrar el equipo no requiera entrar a Supabase.

- Componente nuevo `components/usuarios-admin.tsx`, sección `#usuarios` sumada a
  la nav de `components/header.tsx` **solo** cuando
  `auth.canRead && auth.role === "administrador"` (mismo patrón que
  `#aprobaciones`).
- Tabla de perfiles desde `listar_perfiles()`: nombre, email, rol con
  `.badge-soft`, fecha del último cambio.
- Acción "Cambiar rol" → `components/confirm-dialog.tsx` (nada de
  `window.confirm`) con selector de rol y **textarea de fundamento obligatorio**,
  con el mismo mínimo que valida el RPC y el error visible antes de enviar.
- Historial de cambios por usuario, en un panel montado con
  `hooks/use-modal-shell.ts`.
- Feedback con `toast(...)`. Fail-closed: si `listar_perfiles()` falla, se
  bloquean las acciones y no se infiere autorización.
- Tipografía con `text-micro` / `text-tiny` / `.micro-label`. No volver a
  `text-[8px]`.

## Verificación del paquete E

- `npx tsc --noEmit`
- `npm run test:workflow`, extendido con estas invariantes nuevas:
  1. `asignar_rol` rechaza sin fundamento suficiente;
  2. rechaza el auto-cambio de rol;
  3. rechaza quedarse sin administradores;
  4. un UPDATE directo de `rol` sobre `perfiles` falla;
  5. una sesión `consulta` no obtiene `empresa`, `cuit` ni `padron_cisi` por
     ninguna vía, incluidas las respuestas de "Preguntale al mapa";
  6. la evidencia no se entrega si el registro de auditoría falla.
- `npx next build` — el First Load JS de `/` está en ~202 kB. **No engordarlo.**
- Al terminar, actualizá `CLAUDE.md` y `docs/decisiones-y-roadmap.md` con la
  migración 16 y su alcance, y dejá anotado en el roadmap que la migración
  **queda pendiente de aplicación manual por Lucas** en el SQL Editor.

---

# PAQUETE F — Indicadores de gestión

Solo después de que E esté verificado. Este es el paquete que se muestra en la
presentación: hoy las tarjetas de `components/stats-cards.tsx` son descriptivas
("documentos cargados", "carteles identificados") y ninguno de los siete
indicadores acordados en el roadmap existe.

Implementar los siete, calculados en PostgreSQL mediante un RPC
`public.indicadores_gestion(p_desde date, p_hasta date, p_zona text)`:

1. **Cobertura territorial** — porcentaje de puntos territoriales vinculados y
   verificados.
2. **Inspecciones completadas** — cantidad y porcentaje sobre el total programado.
3. **Tasa de regularización** — carteles regularizados sobre los observados.
4. **Tiempo hasta la primera inspección** — desde el alta o detección.
5. **Tiempo de resolución** — desde la detección hasta regularización,
   resolución o archivo.
6. **Antigüedad del backlog** — casos abiertos agrupados por rangos de tiempo.
7. **Calidad de datos** — porcentaje de registros completos, georreferenciados y
   con fuente oficial.

Requisitos:

- Segmentables por zona, empresa, estado, inspector y período, **respetando los
  permisos**: una sesión `consulta` no puede segmentar por empresa (E2).
- Cada indicador debe declarar su procedencia con el vocabulario ya acordado:
  dato territorial calculado, administrativo oficial, aportado en inspección,
  pendiente de verificación o de demostración. **Ningún dato simulado puede
  presentarse como situación administrativa real.**
- Un indicador sin datos suficientes se muestra como tal, no como cero.
- Sección nueva en el dashboard, respetando los tokens de motion de
  `tailwind.config.ts` y `prefers-reduced-motion`. Animar solo transform y
  opacity.
- El cálculo va en PostgreSQL, no en el cliente: el árbol es 100% cliente y no
  hay que traer el registro entero al navegador para contar.

---

## Fuera de alcance en este tramo

No tocar, ya está decidido:

- Paquete D (mobile administrativo) y flujo offline: pospuestos hasta que haya
  inspectores en la calle.
- Ratificación de los 13 vínculos heredados: es una tarea administrativa de
  Lucas desde la bandeja de aprobaciones, no de código.
- Auditoría versionada de respuestas normativas: es el próximo paquete grande,
  pero no entra en la presentación.
- Purga de los PDF y OCR del historial de Git: coordinado y previo a publicar el
  repositorio.
