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
