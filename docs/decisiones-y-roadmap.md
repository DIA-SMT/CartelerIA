# CartelerIA — decisiones de producto y roadmap

Fecha de consolidación: 2026-07-31.

Este documento registra las decisiones acordadas para orientar el desarrollo de
CartelerIA. No describe necesariamente el estado actual de implementación.

## Estado de implementación al 2026-07-31

- La migración 11 de privacidad fue aplicada en Supabase por el responsable del
  proyecto y verificada.
- La interfaz pública ya no consulta ni empaqueta el registro administrativo.
- Los estados administrativos simulados fueron retirados de la experiencia.
- La migración 12 fue aplicada y verificada. Junto con su interfaz implementa:
  - aprobación administrativa de vínculos;
  - transiciones validadas en PostgreSQL;
  - fundamento obligatorio;
  - solicitudes de roles operativos;
  - resolución exclusiva por administrador;
  - bitácora inmutable de cambios;
  - conservación de inspecciones, fotografías y documentos.
- Las migraciones 13 y 14 fueron aplicadas y verificadas. Su alcance es:
  - forzar estados iniciales válidos y exigir un vínculo aprobado antes de crear
    actuaciones;
  - devolver los 13 vínculos heredados a `pendiente` para que un administrador
    humano los ratifique con fundamento;
  - convertir la evidencia en `insert-only`, con huella SHA-256 y sin
    sobrescrituras;
  - reforzar la bitácora inmutable;
  - permitir la repostulación de vínculos rechazados;
  - reservar la cola global de aprobaciones al rol administrador;
  - tratar `service_role` como identidad técnica, nunca como aprobación legal;
  - hacer que la interfaz falle de forma cerrada y limpie el contexto privado
    al cambiar o cerrar sesión;
  - reservar rutas de evidencia antes del upload, verificar sus bytes en el
    servidor y limpiar huérfanos de forma idempotente;
  - cerrar el acceso anónimo al corpus RAG, aplicar cuota distribuida, conservar
    hashes de PDF/texto y reemplazar cada documento atómicamente.
- El corpus fue reingerido y verificado con 15 documentos, 192 chunks, contrato
  v1, hashes completos, cero huérfanos y cero fuentes habilitadas para IA
  externa.
- Los buckets de evidencia fueron verificados como privados, con límite de 10
  MB y MIME acotados.
- Los PDF/OCR administrativos fueron retirados de los árboles servidos y se
  conservan localmente bajo `private/`, excluidos de Git y Vercel. Las versiones
  históricas de Git todavía contienen esos archivos y requieren un tratamiento
  coordinado antes de publicar el repositorio.
- `npm run test:workflow` valida las reglas críticas de este flujo.
- Los 13 vínculos heredados permanecen pendientes y requieren ratificación
  individual de un administrador con fundamento.
- La migración 15 quedó aplicada: los cinco probes full-text pasaron y la traza
  serverless de `/api/normativa` no contiene el modelo de embeddings.
- La inspección visual de la fuente primaria corrigió Ordenanza 4828/2014 a
  Ordenanza 4728/2014; catálogo, PDF y metadatos live quedaron sincronizados.

## Estado de implementación al 2026-08-06 (paquete E)

La migración 16 (`20260806_16_gobernanza_identidades.sql`) está escrita,
verificada con `tsc`, `npm run test:workflow` y `next build`, y **queda
pendiente de aplicación manual por Lucas en el SQL Editor de Supabase**. Hasta
que se aplique, la interfaz nueva no tiene contraparte en la base: el panel de
usuarios no podrá listar perfiles y la evidencia se seguirá sirviendo solo si
las policies viejas siguen vigentes.

Su alcance:

- **Gobernanza de roles.** Cambiar un rol dejó de ser un `update` a mano. La RPC
  `asignar_rol` exige administrador autenticado (excluye `service_role`),
  fundamento de al menos 12 caracteres, prohíbe el auto-cambio y prohíbe dejar
  la instancia sin administradores; es no-op silencioso si el rol no cambia y
  escribe `perfiles_historial` en la misma transacción. `perfiles` queda con
  `revoke` de escritura y un trigger que rechaza todo UPDATE de `rol` que no
  provenga de la RPC. La recuperación ante una instancia sin administradores
  exige una migración deliberada: no se dejó atajo silencioso.
- **Privacidad consultiva.** El rol `consulta` ya no lee las tablas base de
  `carteles`, `inspecciones` ni `expedientes`, sino vistas sin empresa, CUIT ni
  padrón (y sin las identidades de los agentes que solicitaron o aprobaron
  vínculos). Del lado cliente, la fuente se elige por rol, el campo restringido
  se muestra como "Restringido por rol" y no como vacío, y se cerraron las tres
  vías indirectas: el ranking por empresa de "Preguntale al mapa", el campo
  `empresa` de todo listado de resultados y la exportación XLSX/dossier de
  expedientes.
- **Auditoría de lectura.** `acceso_datos_sensibles` registra quién consultó
  datos fiscales o evidencia. La evidencia se autoriza en el servidor:
  `app/api/evidence/access` verifica sesión y rol, y la RPC resuelve las rutas y
  escribe la auditoría en una sola transacción, de modo que un fallo de registro
  deshace la entrega. La lectura directa de los buckets quedó revocada.
- **Panel de usuarios.** Sección `#usuarios`, solo administrador: padrón con
  nombre, email, rol y último cambio, cambio de rol con fundamento obligatorio
  confirmado en diálogo propio, e historial inmutable por cuenta.

### Antes de aplicar la 16, en el SQL Editor

Las vistas consultivas corren con los privilegios de su dueño (no
`security_invoker`) para poder leer la tabla base que la nueva policy le cierra
al rol `consulta`, y llevan su propia guarda de rol adentro. Eso depende de dos
supuestos que conviene confirmar en la instancia real:

```sql
select relname, relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) as owner
from pg_class
where relname in ('carteles','inspecciones','expedientes','perfiles');
```

Si `relforcerowsecurity` fuera `true` en alguna, o el owner no fuera `postgres`,
las vistas devolverían cero filas **a todos los roles** y el mapa quedaría vacío.
Hoy no hay ningún `force row level security` en el repo, así que lo esperable es
`false` y `postgres` en las cuatro.

Después de aplicar:

- Si `carteles_consulta` respondiera 404, es la caché de esquema de PostgREST:
  `notify pgrst, 'reload schema';`.
- El Advisor de Supabase va a marcar las tres vistas nuevas como
  `security_definer_view` (lint 0010). Es exactamente lo que la migración busca:
  sin eso, la vista no podría leer la tabla base para el rol `consulta`.
- **Probar una carga real de fotografía y de documento.** La migración acota la
  lectura del bucket al objeto propio en lugar de revocarla del todo, porque un
  `INSERT` con `RETURNING` también pasa por las policies de `SELECT` y sin
  ninguna el upload falla. Ni el typecheck, ni el build, ni los tests detectan
  esa rotura: se vería recién al intentar subir evidencia.

Decisiones tomadas al implementar, que el plan no fijaba:

- Las columnas físicas nuevas usan `created_at`, como las cuatro tablas de
  historial ya existentes; los nombres en español (`creado_en`,
  `rol_cambiado_en`) quedan como contrato de las RPC, no del esquema.
- Las vistas consultivas omiten además `vinculo_solicitado_por` y
  `vinculo_aprobado_por`: son identidades de agentes municipales y ningún
  componente cliente las usaba.
- `expediente_documentos` e `inspeccion_fotos` conservan sus policies: no tienen
  datos personales en columnas y su binario se cierra por Storage. Queda
  anotado que `descripcion`, `nota` y `fundamento` son texto libre donde una
  persona podría tipear un CUIT; cerrarlos exigiría revisar contenido, no
  permisos.
- `/api/ask` seguía sin autenticación y devolviendo el intent crudo del
  intérprete local. Se lo dejó en pie pero ahora revalida con los permisos
  mínimos: nunca devuelve un intent que filtre o agrupe por empresa.

## Estado de implementación al 2026-08-06 (paquete F)

La migración 17 (`20260806_17_indicadores_gestion.sql`) está escrita y **también
queda pendiente de aplicación manual**, después de la 16. Agrega
`indicadores_gestion(p_desde, p_hasta, p_zona, p_empresa, p_estado, p_inspector)`
y `zonas_disponibles()`, y no crea ninguna tabla: solo lee.

Los siete indicadores se calculan en PostgreSQL y viajan como un único `jsonb`
donde cada uno declara procedencia, si tiene datos suficientes, numerador,
denominador y un detalle en prosa. La sección `#indicadores` del dashboard los
muestra sin recalcular nada.

Decisiones que conviene conocer antes de leer los números en una presentación:

- **Cobertura territorial.** El universo territorial vive en los GeoJSON
  servidos, no en PostgreSQL, así que la base no puede dividir por él sin
  inventarlo. El indicador informa los vínculos ratificados por un administrador
  sobre el registro administrativo, declarado como dato administrativo oficial.
  La comparación contra la capa territorial completa sigue siendo una lectura
  del mapa, no de este indicador.
- **Inspecciones completadas.** Depende de `programada_para` e
  `inspeccionada_en`, que hoy la aplicación nunca escribe: el alta de inspección
  no pide fecha. Mientras siga así, el indicador se muestra explícitamente como
  "sin datos" y aclara cuántas inspecciones hay cargadas y cuántas tienen
  resultado. No se lo maquilló con un 0%: si aparece un porcentaje, es porque
  alguien empezó a programar inspecciones con fecha.
- **Tasa de regularización.** Se mide sobre `inspeccion_historial`, no sobre el
  estado vigente: un cartel ya regularizado dejó de figurar como observado, así
  que contarlo por estado actual daría siempre cero.
- **Tiempos.** Se reportan como mediana, no promedio, para que un caso viejo no
  arrastre el número. La demora hasta la primera inspección se mide desde el
  alta del registro, que es el hecho que el sistema puede fechar con certeza.
- **Ventana temporal.** Filtra por fecha de alta del registro administrativo.
- **Permisos.** La segmentación por empresa está cerrada para el rol `consulta`:
  un filtro por razón social la reconstruye aunque el campo nunca se muestre. El
  RPC rechaza el parámetro en vez de ignorarlo en silencio.
- `components/zone-ranking.tsx` seguía sin importarse desde ningún lado y con
  datos simulados. Se eliminó en este tramo en lugar de revivirlo para
  indicadores.

## Propósito

CartelerIA será una herramienta oficial para tomar decisiones administrativas
sobre cartelería urbana en San Miguel de Tucumán.

El sistema debe ayudar a iniciar una capacidad municipal que hoy no está
formalmente desarrollada: relevar, inspeccionar, regularizar y dar seguimiento a
la cartelería urbana.

## Decisiones confirmadas

### Fuentes de información

- El mapa territorial y el registro administrativo son fuentes complementarias.
- Cada dato debe indicar su procedencia y distinguir entre:
  - dato territorial calculado;
  - dato administrativo oficial;
  - dato aportado durante una inspección;
  - dato pendiente de verificación;
  - dato de demostración.
- Ningún dato simulado debe presentarse como situación administrativa real.

### Vinculación territorial y administrativa

- La aplicación puede proponer vínculos entre puntos territoriales y registros
  administrativos.
- Un vínculo solo adquiere carácter oficial después de la aprobación de un
  administrador.
- La aprobación debe conservar usuario, fecha, método, evidencia y cambios
  posteriores.

### Privacidad

- Empresa, CUIT, padrón, deuda, situación tributaria, fotografías, inspecciones y
  expedientes no deben quedar expuestos públicamente por defecto.
- La separación entre información pública y privada debe imponerse en Supabase
  mediante vistas, permisos y RLS; ocultar campos solamente en React no alcanza.
- La capa pública debería limitarse a información territorial o agregada que se
  defina expresamente como publicable.

### Roles y trazabilidad

- Las transiciones de inspecciones y expedientes tienen valor administrativo.
- Las transiciones válidas deben imponerse en PostgreSQL, además de orientarse
  desde la interfaz.
- Toda acción relevante debe conservar una trazabilidad inmutable:
  - usuario;
  - rol;
  - fecha y hora;
  - estado anterior y nuevo;
  - motivo o nota;
  - evidencia asociada.

### Trabajo territorial

- La aplicación debe poder utilizarse desde celulares sin conexión.
- Las operaciones offline deben encolarse y sincronizarse posteriormente.
- La estrategia debe contemplar cifrado local, archivos pendientes, conflictos,
  reintentos, idempotencia y auditoría de sincronización.

### Infraestructura

- El despliegue inicial previsto es Vercel/serverless.
- El rate limiting no debe depender de memoria local de una instancia.
- Los procesos pesados de embeddings y OCR no deben depender de cachés efímeras
  ni de cold starts impredecibles.

### Asistente normativo

- Las respuestas deben poder respaldar decisiones legales, pero nunca producir
  automáticamente una resolución administrativa.
- Toda respuesta utilizada en un expediente requiere revisión y aprobación
  humana.
- Deben conservarse:
  - pregunta original;
  - usuario solicitante;
  - fecha;
  - modelo y versión;
  - versión del corpus;
  - documentos, páginas y fragmentos recuperados;
  - hashes de los documentos;
  - respuesta generada;
  - revisión o aprobación humana.
- El sistema debe negarse a concluir cuando la evidencia sea insuficiente,
  contradictoria o provenga de OCR de baja confianza sin revisión.

### Interfaz

- Los botones Buscar y Notificaciones se ocultarán mientras no tengan una
  funcionalidad real.
- Ambas funciones quedan reservadas para una fase futura y no deben olvidarse al
  definir el backlog posterior al núcleo operativo.

## Indicadores de éxito

Los siete están implementados en la migración 17 y en la sección
`#indicadores`. Ver "Estado de implementación al 2026-08-06 (paquete F)" para
las salvedades de cada uno.

Los indicadores principales serán:

1. Cobertura territorial:
   porcentaje de puntos territoriales vinculados y verificados.
2. Inspecciones completadas:
   cantidad y porcentaje de inspecciones finalizadas respecto del total
   programado.
3. Tasa de regularización:
   carteles regularizados respecto de los que recibieron observaciones.
4. Tiempo hasta la primera inspección:
   desde la detección o alta hasta la visita.
5. Tiempo de resolución:
   desde la detección hasta la regularización, resolución o archivo.
6. Antigüedad del backlog:
   casos abiertos agrupados por rangos de tiempo.
7. Calidad de datos:
   porcentaje de registros completos, georreferenciados y con fuente oficial.

Las métricas deben poder segmentarse por zona, empresa, estado, inspector y
período, respetando los permisos de acceso.

## Bloqueos para uso oficial

### Prioridad crítica

- [x] Retirar o identificar inequívocamente los estados administrativos simulados.
- [x] Separar datos públicos y privados en la base.
- [x] Implementar aprobación administrativa de vínculos en código y migración.
- [x] Validar transiciones en PostgreSQL en la migración 12.
- [x] Aplicar y verificar la migración 12 en Supabase.
- [x] Incorporar, aplicar y verificar las migraciones 13 y 14 de endurecimiento.
- [x] Reingerir y verificar el corpus RAG con contrato atómico v1.
- [ ] Ratificar manualmente los 13 vínculos heredados después de aplicar la
  migración 13.
- [ ] **Aplicar la migración 16 en el SQL Editor.** Está escrita y verificada
  contra `tsc`, tests y build, pero no se puede probar sin correrla: no hay CLI
  vinculado. Después de aplicarla conviene revisar cuántas cuentas quedaron con
  rol `administrador` desde el panel `#usuarios`: el UPDATE masivo de la
  migración 07 nunca se revirtió en datos.
- [ ] Crear auditoría de las respuestas normativas; la auditoría operativa ya
  está cubierta por la migración 12.
- [ ] Implementar revisión/aprobación administrativa versionada del corpus y de
  las respuestas antes de considerarlas respaldo jurídico.
- [x] Actualizar dependencias vulnerables: auditoría de producción en cero y
  SheetJS reemplazado por un generador XLSX mantenido.

### Prioridad alta

- Incorporar pruebas automáticas, lint y CI.
- Diseñar el flujo offline y la sincronización.
- Hacer visible la fuente, vigencia y estado de sincronización de los datos.
- Consolidar migraciones y procedimientos de despliegue.
- Implementar almacenamiento consistente, evitando archivos huérfanos o
  referencias rotas.
- [x] Adaptar rate limiting y retrieval al entorno serverless: cuota distribuida
  y búsqueda full-text privada en PostgreSQL; el modelo pesado queda offline.
- Incorporar métricas y alertas del endpoint normativo en Vercel.
- Adoptar TUS/resumable para evidencia mayor a 6 MB o bajar el límite operativo.

### Prioridad media

- Poner cuota a `registrar_acceso_sensible`. Está otorgada a `authenticated` y
  acepta `recurso_id` como texto libre: una cuenta municipal podría inflar la
  tabla insert-only atribuyéndose accesos que nunca ocurrieron. Los accesos a
  evidencia sí pasan por `consumir_cuota_evidencia`; la vía directa de datos
  fiscales, no.
- Unificar el cliente `service_role`: `lib/supabase-admin.ts` existe y lo usa la
  ruta de evidencia, pero `finalize`, `cleanup` y `normativa` todavía lo
  instancian inline. No se refactorizaron en este tramo por ser código de
  seguridad ya verificado que no se puede ejercitar sin la base viva.
- Dividir componentes con exceso de estado local.
- Completar accesibilidad de diálogos y navegación por teclado.
- Retirar código sin uso.
- Revisar rendimiento del árbol cliente y de las animaciones.
- Definir el alcance futuro de Buscar y Notificaciones.

## Autenticación: verificación operativa

Verificación realizada el 2026-07-29:

- Se observó una cuenta con rol `administrador`.
- `Allow new users to sign up`: desactivado.
- `Allow anonymous sign-ins`: desactivado.
- `Allow manual linking`: desactivado.
- `Confirm email`: activado.

Para mantener esta configuración segura:

- Los usuarios deben ser creados o invitados por un administrador.
- Cada usuario debe poseer una fila en `public.perfiles` con el rol mínimo
  necesario.
- Estas opciones deben revisarse nuevamente antes de una publicación.

## Recordatorios para fases futuras

- Reconsiderar Buscar cuando exista una búsqueda transversal real sobre mapa,
  documentos, inspecciones y expedientes.
- Reconsiderar Notificaciones cuando estén definidos responsables, eventos,
  prioridades, canales y reglas de escalamiento.
- Revisar nuevamente qué información puede publicarse antes de cualquier salida
  pública.
- No habilitar decisiones automáticas basadas únicamente en resultados de IA.
- Antes de hacer público el repositorio, revisar/purgar coordinadamente los PDF
  y OCR administrativos que permanecen en el historial de Git.
