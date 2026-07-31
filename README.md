# Cartelería SMT

Plataforma territorial y administrativa de cartelería urbana para San Miguel de Tucumán.

## Desarrollo

```bash
npm install
npm run dev
npm run test:workflow
npm exec tsc -- --noEmit
npm run build
```

`data/documents.ts` contiene únicamente las dos normas que pueden incorporarse
al bundle público. Los PDF administrativos y sus OCR se conservan localmente
bajo `private/`, excluidos de Git y de Vercel. El catálogo interno vive en
`data/internal-documents.ts` y solo lo importan rutas server-side o scripts
offline.

Para revisar o reconstruir el corpus:

```bash
npm run ocr:docs
npm run ingest:docs:dry
npm run ingest:docs
```

Los scripts usan el soporte TypeScript integrado de Node 24; no descargan un
runner ad hoc.

`npm run test:workflow` valida las reglas críticas del flujo administrativo
(estados iniciales, aprobaciones, repostulación, permisos y evidencia
inmutable). Debe ejecutarse junto con el typecheck y el build antes de publicar
cambios en este flujo.

## Supabase

La capa territorial pública se sirve desde GeoJSON estáticos. El registro
administrativo se carga exclusivamente desde Supabase y requiere una sesión;
no tiene fallback público porque contiene información privada.

1. Copiar `.env.example` como `.env.local` y completar URL y clave anónima.
2. Ejecutar `supabase/schema.sql` en el SQL Editor de Supabase.
3. Ejecutar las migraciones de `supabase/migrations/` en orden.
4. Solo para una instalación nueva, ejecutar `private/supabase/seed_part_1.sql`,
   `seed_part_2.sql` y `seed_part_3.sql`, en ese orden. Esos archivos contienen
   datos administrativos personales, se conservan únicamente de forma local y
   no deben versionarse ni incluirse en despliegues. La base activa ya está cargada.
5. Reiniciar `npm run dev`.

Tras la migración 11, la lectura de `carteles` requiere sesión y la escritura
conserva las políticas de rol operativo. Las cuentas nuevas nacen con rol
`consulta`: los ascensos los hace un administrador en `public.perfiles`. El
registro público y los accesos anónimos deben permanecer deshabilitados en
Supabase Auth.

Las migraciones 11 a 14 ya fueron aplicadas y verificadas en Supabase. La
migración 12 incorpora el flujo administrativo auditable: los inspectores y
coordinadores solicitan cambios de estado; un administrador los aprueba o
rechaza con fundamento. Los vínculos territoriales también requieren aprobación,
las transiciones se validan en PostgreSQL y las actuaciones/evidencias dejan de
tener borrado físico desde la aplicación.

La migración 13 de endurecimiento fuerza estados iniciales y vínculo aprobado;
devolvió los 13 vínculos heredados a ratificación; incorpora reservas de carga, verificación
server-side de bytes, SHA-256, evidencia `insert-only` y limpieza idempotente;
refuerza la bitácora; limita la cola global a administradores; cierra el corpus
RAG anónimo; agrega cuota distribuida; y hace atómica la ingesta documental.
`service_role` queda limitado a tareas técnicas y no equivale a una aprobación
legal. La migración 14 corrige la precedencia del operador JSON del manifiesto
canónico. El corpus fue reingerido y verificado con 15 documentos, 192 chunks,
contrato v1 y cero fuentes habilitadas para IA externa.

La migración 15, aplicada y verificada, reemplaza los embeddings en el request
interactivo por búsqueda full-text privada en PostgreSQL. Así,
`/api/normativa` conserva citas, hashes y gobernanza sin descargar un modelo de
cientos de MB en cada instancia efímera de Vercel. Los cinco probes operativos
pasaron, incluyendo Ordenanza 4728/2014 y Decreto 0609/18. Los embeddings quedan
reservados para la ingesta y otros procesos offline.

La inspección visual del original corrigió un metadato histórico: la norma es
la Ordenanza N.º 4728/2014, sancionada el 27 de noviembre de 2014. El catálogo,
el nombre público del PDF y Supabase quedaron sincronizados con esa fuente.

La interfaz asociada debe fallar de forma cerrada: no puede presentar una
operación como autorizada si falla la carga de permisos, contexto o
aprobaciones, y debe limpiar el contexto privado al cerrar sesión. Los 13
vínculos pendientes deben ser revisados y ratificados individualmente por un
administrador antes de habilitar nuevas actuaciones sobre esos carteles.

Para desplegar esta versión también deben configurarse en Vercel
`SUPABASE_SERVICE_ROLE_KEY` y `CRON_SECRET`, ambos exclusivamente server-side.
Los dos buckets fueron verificados como privados, con límite de 10 MB y MIME
acotados. La migración no modifica directamente el esquema administrado de
Storage.

## Identidad visual obligatoria

- Logo oficial: `public/logo-municipalidad-smt.png`.
- El mismo símbolo se utiliza como favicon desde `app/icon.png`.
- Colores de marca: azul `#0868F7`, celeste `#31ADEF` y amarillo `#FFDA00`.
- Toda página o módulo nuevo debe reutilizar los tokens `municipal` y `brandYellow` definidos en `tailwind.config.ts`.
- No sustituir, recolorear ni deformar el logo.
