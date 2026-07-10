-- ============================================================================
-- Fase 3 — Storage: bucket y políticas para fotos de inspección (idempotente)
-- ----------------------------------------------------------------------------
-- Sin esto, TODO upload a `inspeccion-fotos` falla por RLS de storage.objects
-- y el paso "Evidencia" del formulario queda inutilizable.
--
-- Depende de public.tiene_rol(...) (definido en *_02_add_inspecciones.sql).
-- Reglas de acceso (coinciden con las de la tabla public.inspeccion_fotos):
--   * Lectura: cualquier usuario autenticado.
--   * Escritura (insert/update/delete): solo rol operativo
--     (administrador / coordinador / inspector).
--   * anon: sin acceso.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Bucket privado para las fotos (no público: se sirve por URL firmada).
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inspeccion-fotos',
  'inspeccion-fotos',
  false,
  10485760,                    -- 10 MB por archivo
  array['image/*']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ----------------------------------------------------------------------------
-- 2. Políticas RLS sobre storage.objects, acotadas a este bucket.
--    (storage.objects ya tiene RLS habilitada por Supabase.)
-- ----------------------------------------------------------------------------
drop policy if exists inspeccion_fotos_read on storage.objects;
create policy inspeccion_fotos_read on storage.objects
  for select to authenticated
  using (bucket_id = 'inspeccion-fotos');

drop policy if exists inspeccion_fotos_insert on storage.objects;
create policy inspeccion_fotos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'inspeccion-fotos'
    and public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[])
  );

drop policy if exists inspeccion_fotos_update on storage.objects;
create policy inspeccion_fotos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'inspeccion-fotos'
    and public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[])
  )
  with check (
    bucket_id = 'inspeccion-fotos'
    and public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[])
  );

drop policy if exists inspeccion_fotos_delete on storage.objects;
create policy inspeccion_fotos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'inspeccion-fotos'
    and public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[])
  );
