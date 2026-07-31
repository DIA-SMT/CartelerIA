-- ============================================================================
-- Fase 11 — Privacidad del registro administrativo
-- ----------------------------------------------------------------------------
-- `public.carteles` contiene empresa, CUIT, padrón, ubicación y otros datos de
-- gestión. La capa territorial pública vive en los GeoJSON de /public/data y no
-- necesita consultar esta tabla.
--
-- Resultado:
--   * anon no puede leer ni escribir `public.carteles`;
--   * cualquier usuario autenticado puede leer el registro;
--   * las escrituras conservan las policies por rol de las migraciones previas.
-- ============================================================================

alter table public.carteles enable row level security;

drop policy if exists "carteles_public_read" on public.carteles;
drop policy if exists carteles_authenticated_read on public.carteles;

create policy carteles_authenticated_read on public.carteles
  for select to authenticated
  using (true);

revoke all on public.carteles from anon;
grant select on public.carteles to authenticated;
