alter table public.carteles enable row level security;

drop policy if exists "carteles_public_read" on public.carteles;
create policy "carteles_public_read"
on public.carteles
for select
to anon, authenticated
using (true);

drop policy if exists "carteles_public_location_update" on public.carteles;
create policy "carteles_public_location_update"
on public.carteles
for update
to anon, authenticated
using (true)
with check (true);

revoke all on public.carteles from anon;
grant select on public.carteles to anon;
grant update (domicilio, numero, latitud, longitud, location_source, location_edited, updated_at)
on public.carteles to anon;

grant select, update on public.carteles to authenticated;
