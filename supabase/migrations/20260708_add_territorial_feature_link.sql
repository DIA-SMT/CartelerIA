-- Vinculación explícita entre el registro administrativo y la capa territorial.
-- Es nullable para poder revisar y completar el emparejamiento progresivamente.
alter table public.carteles
  add column if not exists territorial_feature_id text;

create unique index if not exists carteles_territorial_feature_unique_idx
  on public.carteles (territorial_feature_id)
  where territorial_feature_id is not null;

comment on column public.carteles.territorial_feature_id is
  'ID de properties.id en carteles_analizados_buffer75.geojson. Debe validarse antes de asignarlo.';
