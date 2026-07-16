-- Estado endurecido de RLS para public.carteles (idempotente, seguro de
-- re-ejecutar). Histórico: este archivo abría UPDATE anónimo de ubicación para
-- el MVP sin login; eso se cerró en la migración 10 y acá quedó alineado para
-- que re-correrlo nunca reabra el agujero.

alter table public.carteles enable row level security;

drop policy if exists "carteles_public_read" on public.carteles;
create policy "carteles_public_read"
on public.carteles
for select
to anon, authenticated
using (true);

-- Sin escritura anónima.
drop policy if exists "carteles_public_location_update" on public.carteles;
revoke update on public.carteles from anon;

drop policy if exists carteles_update_operativo on public.carteles;
create policy carteles_update_operativo on public.carteles
  for update to authenticated
  using (public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[]))
  with check (public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[]));

revoke all on public.carteles from anon;
grant select on public.carteles to anon;
grant select, update on public.carteles to authenticated;
