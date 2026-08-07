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

## Hallazgo del 2026-08-06: el alta creaba administradores

Al aplicar la migración 16, el trigger `proteger_rol_perfiles` empezó a
rechazar la creación de cuentas con el mensaje "Un perfil nuevo solo puede nacer
con rol consulta". La causa no era el trigger: la función `handle_new_user` de
la instancia seguía siendo la de la **migración 07**, que insertaba
`'administrador'`.

La migración 10 la había corregido a `'consulta'`, y tanto `CLAUDE.md` como este
documento lo daban por hecho desde entonces. En la base viva nunca se aplicó.
Durante ese período, **toda cuenta creada desde el Dashboard nació con el rol
máximo**, sin ninguna señal.

Corregido por la migración 18, que reafirma la definición correcta y falla si el
cuerpo de la función volviera a asignar un rol privilegiado.

Dos conclusiones que conviene no olvidar:

- Verificar una función leyendo el archivo del repositorio no prueba nada sobre
  la instancia. Las migraciones se corren a mano y una puede quedar sin aplicar
  sin dejar rastro. Para afirmar algo de la base, consultarla.
- La guarda de la migración 16 hizo exactamente lo que debía: convirtió un
  desvío silencioso de meses en un error visible. Un fallo ruidoso es el
  resultado buscado, no un efecto colateral.

## Estado de implementación al 2026-08-06 (paquetes G y H)

La navegación pasó a un único cajón lateral (`components/app-sidebar.tsx`) para
todos los tamaños de pantalla, y la administración de identidades dejó de ser
una sección suelta: vive en `#configuracion`, con cinco pestañas.

La **migración 19** (`20260806_19_bitacora_y_corpus.sql`) queda **pendiente de
aplicación manual**. Agrega `bitacora_unificada` (auditoría paginada en la base),
`resumen_corpus_rag` y `estado_buckets_evidencia`. Hasta aplicarla, las pestañas
Auditoría, Seguridad y Corpus fallan en modo cerrado, que es lo correcto.

Decisiones que conviene conocer:

- El cajón se **superpone** al contenido en vez de empujarlo. Es lo que evita
  que Leaflet recalcule su tamaño, que el spotlight del recorrido guiado se
  reposicione y que los anclajes apunten a otro lado.
- Quedó una inconsistencia previa sin tocar: el visor de PDF está en `z-[90]`,
  o sea **por debajo** de la barra superior. Por eso no se pudo cumplir al pie
  de la letra "el cajón por debajo del visor de PDF": el cajón va en 1050, sobre
  la barra. En la práctica no se superponen, porque elegir un ítem cierra el
  cajón. Subir el visor taparía el encabezado y es una decisión visual que
  conviene mirar a ojo antes de cambiarla.
- La pestaña Seguridad separa tres orígenes distintos: lo consultado en vivo
  (buckets), lo verificado a mano con su fecha (ajustes del panel de Supabase) y
  lo declarado en el repositorio (migraciones). La aplicación **no puede saber**
  qué migraciones se aplicaron: no hay CLI ni tabla de migraciones. Presentar esa
  lista como comprobada sería justamente el dato simulado que este documento
  prohíbe, y ya pasó una vez que una migración quedara sin aplicar durante meses.
- La lista de migraciones de esa pantalla tiene un test que la compara con los
  archivos reales de `supabase/migrations/`, para que no se desactualice sola.

## Estado de implementación al 2026-08-06 (Fábrica Normativa)

> **Parcialmente superado.** Lo que sigue describe el módulo como se construyó
> primero, sobre la premisa de que el documento recibido era un borrador a
> aprobar artículo por artículo. Esa premisa era equivocada y el mismo día se
> revirtió buena parte: ver *"La Fábrica deja de pedir permiso"* más abajo. Se
> conserva porque explica por qué existen tablas y RPC que hoy no se usan.

Se agregó `#fabrica`, la mesa donde se escribe la nueva ordenanza de cartelería
artículo por artículo, con tres apoyos permanentes: el borrador recibido, la
normativa vigente y los carteles relevados. Migraciones 20 a 24, **aplicadas y
verificadas contra la instancia el 2026-08-06**: 29 comprobaciones en vivo, que
incluyen los cinco RPC de edición, los 33 artículos sembrados, el borrador como
único documento en estado `proyecto`, y que `service_role` reciba `42501` al
intentar insertar, reescribir o borrar una observación.

La regla que gobierna el módulo es una sola: **la persona es la autora y el
sistema asiste**. Todo lo demás sale de ahí, y se sostiene en PostgreSQL porque
una invariante que solo vive en la interfaz no es una invariante.

Las cinco decisiones que no se negocian:

1. **Nada se sobrescribe.** Guardar un artículo agrega una versión con motivo
   obligatorio. El texto del borrador recibido es inmutable por trigger, para
   poder mostrar siempre qué se cambió y contra qué.
2. **El proyecto no se cita como si fuera derecho vigente.** El borrador entró
   al corpus con `estado_legal = 'proyecto'` y la búsqueda exige estados
   explícitos, sin default permisivo. Un asistente que responde una consulta
   municipal citando un texto sin sancionar es peor que uno que no responde.
3. **Un número sin cita textual no existe.** `norma_parametro` valida que la
   cita aparezca literal en el artículo, y la simulación falla —no asume— si
   falta un parámetro confirmado. Un cartel sin el dato queda `no_evaluable`:
   no cumple ni incumple, falta información.
4. **El asistente propone y nunca guarda.** `/api/fabrica` no llama a ninguna
   RPC de articulado, y los hallazgos cuya cita no se verifica contra los
   fragmentos recuperados se descartan antes de llegar a la base.
5. **Elevar es fail-closed.** Un artículo sin aprobar o un diagnóstico grave sin
   atender bloquean el documento oficial, y se dice cuál. La versión de trabajo
   siempre está disponible, marcada como borrador en cada página.

Otras decisiones que conviene conocer:

- **`estado_legal` se perdía en silencio.** `sincronizar_documento_rag` escribe
  una lista fija de columnas y se comía el campo, así que el borrador quedaba
  como `vigente` y era citable. Se corrigió con la migración 22 en vez de
  reescribir una función de 200 líneas ya verificada. Vale como recordatorio: el
  agujero no estaba en lo que se escribió, sino en lo que una función vieja no
  sabía copiar.
- **La siembra del articulado se desacopló de la ingesta.** Estaba atada a que
  el documento cambiara, así que "sin cambios" la salteaba para siempre. Ahora
  falla y avisa si el proyecto ya tiene artículos, en vez de pisar trabajo hecho.
- **El Word se genera en el navegador** con `docx` en import diferido, igual que
  el XLSX de expedientes; el PDF sale de `@media print`. Meter un navegador
  headless en una función serverless sería la dependencia más pesada y frágil
  del proyecto para conseguir lo mismo. El PDF es la pieza menos verificable de
  acá: conviene mirarlo a ojo antes de usarlo en serio.
- **Las observaciones de las áreas son el único lugar donde el rol `consulta`
  escribe**, y escribe una opinión, no un acto administrativo. Es justamente la
  razón de que el rol exista. Insert-only: nadie edita ni borra, tampoco la
  propia —se agrega otra—, porque una opinión reescrita después no sirve como
  antecedente de nada, y estas observaciones son exactamente eso: el antecedente
  de por qué el articulado terminó como terminó.
- **Queda abierto** si un diagnóstico grave sobre un artículo *descartado*
  debería bloquear la elevación. Hoy no bloquea, porque ese artículo no va en el
  documento. Es discutible y conviene decidirlo con criterio jurídico, no
  técnico.
- **Pendiente de decisión de Lucas**: habilitar IA externa
  (`ENABLE_EXTERNAL_NORMATIVA_AI=true` más marcar documentos como revisados por
  humano y habilitados para salida externa). Hasta entonces el asistente de la
  Fábrica se niega a redactar, por diseño, y muestra los fragmentos de la
  vigente para leerlos en pantalla.

## 2026-08-06, cierre del día: la Fábrica deja de pedir permiso

Lucas lo dijo así: *"creo que complicamos las cosas al pedo… lo que hizo mi jefe
el archivo Word sería como la nueva normativa que regularía el tema de carteles
en SMT, entonces lo que hizo mi jefe está bien"*.

Tenía razón, y la premisa equivocada era del diseño original: se asumió que el
documento recibido era un borrador a revisar y aprobar. **No lo es: es la
normativa nueva.** Sobre esa premisa se montó un aparato de aprobaciones que
tiene sentido para un expediente administrativo y ninguno para una mesa de
redacción.

### Qué quedó

Lista de artículos · Guardar · Quitar del documento · Artículo nuevo (lienzo) ·
Revisar contra el documento · impacto sobre los carteles · exportar a PDF.

Sin estados, sin fundamentos obligatorios, sin compuertas. Entre los dos commits
del cierre se borraron unas 2400 líneas.

### Qué se sacó y por qué

- **Los cuatro estados y sus diálogos.** Queda un botón para quitar un artículo
  del documento y su reverso. `estado` sobrevive como mecanismo, no como
  etiqueta que alguien lea.
- **Los motivos obligatorios.** El historial se sigue escribiendo solo, con
  fecha y autor. Lo único que desapareció es la obligación de justificarse.
- **Word y Excel.** Una sola salida: PDF. Dos formatos menos que mantener y una
  decisión menos que tomar cada vez.
- **El contraste contra la normativa vigente**, con sus diagnósticos y la
  compuerta de exportación. Con eso salió del camino toda la maquinaria de
  habilitar documentos del corpus, que era el motivo por el que el asistente se
  negaba a redactar la mayoría de las veces.
- **Las observaciones de las áreas.**

### Qué se mantuvo, y el criterio

Se mantuvo lo que **no cuesta un solo clic**: el historial automático, la
verificación textual de las citas, y que no salgan datos personales al proveedor
externo. Una garantía que no le pide nada a quien trabaja no es ceremonia.

### Lo que se aprendió construyendo esto

- **Una condición que nunca corta nada, escrita como si cortara, engaña.** Al
  sacar el veto del OCR dudoso, la tentación era escribir
  `not ocr_doubtful or human_reviewed`. Es una tautología —la revisión humana ya
  era obligatoria— y se leería como un guard. Se sacó el término y se explicó
  por qué.
- **La verificación de citas descartaba hallazgos correctos.** Probando el
  revisor contra los 33 artículos reales, detectó una contradicción de verdad
  —un artículo fijaba 2 m² y el 14 fija 60 m²— y se descartó porque el modelo
  empezó la cita con "como" donde el artículo dice "Como". Ahora la comparación
  ignora mayúsculas y devuelve el recorte de la fuente. Una cita inventada no
  coincide por casualidad en 25 caracteres.
- **Un editor que guarda en memoria tiene que avisar antes de cerrarse.** Se
  perdieron cinco páginas de corrección de OCR por no tener ese aviso, que sí
  se le había puesto al lienzo de artículos el mismo día.
- **Reordenar el trabajo por lo que destraba, no por el plan.** El plan decía
  corregir el OCR primero; medir mostró que la búsqueda ni siquiera llegaba al
  documento habilitado, así que eso iba antes.

### Sin uso, a propósito

Estas piezas quedaron construidas y sin conectar. No molestan y se pueden
retomar; conviene saber que están:

- `norma_observacion` (migración 24): tabla sin uso. Se puede borrar cuando
  convenga; se dejó para no obligar a correr un drop.
- `norma_diagnostico` y sus RPC (migración 23): sin uso desde que se sacó el
  contraste contra la vigente.
- El editor de OCR y la habilitación de IA externa por documento (migraciones
  26 a 28): la Fábrica ya no los necesita, pero **siguen sirviendo a
  `/api/normativa`**, que es otra sección.
- **`doc-02` (Decreto 0609/18) sigue habilitado para salir hacia OpenRouter.**
  Lo autorizó Lucas con fundamento el 2026-08-06 para probar la Fábrica. La
  Fábrica ya no lo usa; `/api/normativa` sí. Si se quiere dar de baja, se hace
  desde Configuración › Corpus.

### Lo que sigue

1. **Cambiar `OPENROUTER_MODEL`**, que sigue en `openai/gpt-4o-mini`. Ahora que
   el asistente redacta y revisa sin depender del corpus, el modelo es el cuello
   de botella.
2. **Pasada visual completa** de la Fábrica simplificada en un navegador real,
   incluido el PDF. Nada de esto se pudo mirar a ojo desde el entorno de
   trabajo.
3. Decidir si el panel de parámetros y simulación se queda como está. Lucas
   pidió conservarlo; la cita ahora se autocompleta, así que la fricción que
   tenía se fue.

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

- Volver a activar `reactStrictMode`. Está apagado desde el 2026-08-06 porque
  react-leaflet 4.2.1 crea el mapa en un callback de ref cuya limpieza nunca lo
  destruye, así que el doble montaje de StrictMode rompía el mapa en dev. El
  arreglo de fondo es migrar a react-leaflet 5, que requiere React 19.
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
