create table if not exists public.carteles (
  id text primary key,
  empresa text not null default '',
  cuit text not null default '',
  tipo_cartel text not null default 'CARTEL',
  dimensiones text not null default '',
  superficie_m2 numeric,
  domicilio text not null default '',
  numero text not null default '',
  google_maps_url text not null default '',
  padron_cisi text not null default '',
  estado text not null default 'Relevado' check (estado in ('Relevado','Normativa','Proyecto')),
  latitud double precision,
  longitud double precision,
  location_source text check (location_source in ('google_maps','nominatim','manual')),
  status text not null default 'sin_datos' check (status in ('relevado','habilitado','pendiente','observado','infraccion','sin_datos')),
  contamination_level text not null default 'bajo' check (contamination_level in ('bajo','medio','alto','critico')),
  zone text not null default 'Otros sectores',
  street_view_image_url text,
  original_latitud double precision,
  original_longitud double precision,
  location_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists carteles_status_idx on public.carteles(status);
create index if not exists carteles_contamination_idx on public.carteles(contamination_level);
create index if not exists carteles_zone_idx on public.carteles(zone);

alter table public.carteles enable row level security;

drop policy if exists "carteles_public_read" on public.carteles;
create policy "carteles_public_read" on public.carteles for select to anon, authenticated using (true);

drop policy if exists "carteles_public_location_update" on public.carteles;
create policy "carteles_public_location_update" on public.carteles for update to anon, authenticated using (true) with check (true);

revoke all on public.carteles from anon;
grant select on public.carteles to anon;
grant update (domicilio, numero, latitud, longitud, location_source, location_edited, updated_at) on public.carteles to anon;
grant select, update on public.carteles to authenticated;

create table if not exists public.documentos (
  id text primary key,
  title text not null,
  category text not null,
  description text not null default '',
  document_date date,
  pdf_url text,
  created_at timestamptz not null default now()
);

alter table public.documentos enable row level security;
drop policy if exists "documentos_public_read" on public.documentos;
create policy "documentos_public_read" on public.documentos for select to anon, authenticated using (true);
grant select on public.documentos to anon, authenticated;

-- Políticas públicas temporales para el MVP sin login.
-- Antes de producción, reemplazar la actualización anónima por políticas basadas en auth.uid().
