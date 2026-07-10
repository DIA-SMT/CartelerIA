-- ============================================================================
-- Fase 3 — Módulo de inspecciones (migración idempotente y segura)
-- ----------------------------------------------------------------------------
-- Puede ejecutarse múltiples veces sin efectos secundarios.
-- Diseño alineado con data/inspections.ts (mismas claves de estado).
--
-- Seguridad:
--   * RLS habilitada en todas las tablas nuevas.
--   * SIN escrituras anónimas. La escritura requiere usuario autenticado con
--     rol (administrador / coordinador / inspector).
--   * El historial de estados lo escribe únicamente el trigger.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Roles de la aplicación (preparados para autenticación futura)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_rol') then
    create type public.app_rol as enum ('administrador', 'coordinador', 'inspector', 'consulta');
  end if;
end $$;

create table if not exists public.perfiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  rol        public.app_rol not null default 'consulta',
  nombre     text,
  created_at timestamptz not null default now()
);

comment on table public.perfiles is
  'Perfil y rol de cada usuario autenticado. Base para RLS por rol.';

-- ----------------------------------------------------------------------------
-- Helper: ¿el usuario actual tiene alguno de los roles indicados?
-- SECURITY DEFINER para poder leer perfiles sin exponer la tabla.
-- ----------------------------------------------------------------------------
create or replace function public.tiene_rol(roles public.app_rol[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.perfiles p
    where p.user_id = auth.uid()
      and p.rol = any(roles)
  );
$$;

-- ----------------------------------------------------------------------------
-- 1. Catálogo configurable de estados de inspección
--    (equivalente en DB de INSPECTION_STATES en data/inspections.ts)
-- ----------------------------------------------------------------------------
create table if not exists public.inspeccion_estados (
  key        text primary key,
  label      text not null,
  categoria  text not null,
  orden      integer not null default 0,
  color      text not null default '#64748b',
  es_final   boolean not null default false,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Seed idempotente: mantiene el catálogo sincronizado en cada ejecución.
insert into public.inspeccion_estados (key, label, categoria, orden, color, es_final) values
  ('nuevo_relevamiento',    'Nuevo relevamiento',    'inicial',        10,  '#0166FF', false),
  ('pendiente_revision',    'Pendiente de revisión', 'inicial',        20,  '#2DB0FF', false),
  ('inspeccion_programada', 'Inspección programada', 'proceso',        30,  '#6366f1', false),
  ('inspeccionado',         'Inspeccionado',         'proceso',        40,  '#0ea5e9', false),
  ('regular',               'Regular',               'resultado',      50,  '#16a34a', false),
  ('con_observaciones',     'Con observaciones',     'resultado',      60,  '#eab308', false),
  ('notificado',            'Notificado',            'regularizacion', 70,  '#f97316', false),
  ('en_regularizacion',     'En regularización',     'regularizacion', 80,  '#f59e0b', false),
  ('regularizado',          'Regularizado',          'cierre',         90,  '#16a34a', true),
  ('derivado_expediente',   'Derivado a expediente', 'cierre',         100, '#dc2626', false),
  ('cerrado',               'Cerrado',               'cierre',         110, '#475569', true)
on conflict (key) do update set
  label     = excluded.label,
  categoria = excluded.categoria,
  orden     = excluded.orden,
  color     = excluded.color,
  es_final  = excluded.es_final;

-- ----------------------------------------------------------------------------
-- 2. Inspecciones (relación con carteles)
-- ----------------------------------------------------------------------------
create table if not exists public.inspecciones (
  id             uuid primary key default gen_random_uuid(),
  cartel_id      text not null references public.carteles(id) on delete cascade,
  estado         text not null default 'nuevo_relevamiento'
                   references public.inspeccion_estados(key),
  -- Características físicas
  tipo_soporte   text,
  ancho_m        numeric check (ancho_m is null or ancho_m >= 0),
  alto_m         numeric check (alto_m  is null or alto_m  >= 0),
  -- Superficie calculada automáticamente = ancho × alto (2 decimales)
  superficie_m2  numeric generated always as (
                   case
                     when ancho_m is not null and alto_m is not null
                       then round((ancho_m * alto_m)::numeric, 2)
                     else null
                   end
                 ) stored,
  -- Situación administrativa
  empresa        text,
  cuit           text,
  observaciones  text,
  -- Trazabilidad
  programada_para   date,
  inspeccionada_en  timestamptz,
  inspector_id      uuid references auth.users(id),
  created_by        uuid references auth.users(id) default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists inspecciones_cartel_idx on public.inspecciones(cartel_id);
create index if not exists inspecciones_estado_idx on public.inspecciones(estado);

comment on column public.inspecciones.superficie_m2 is
  'Columna generada: ancho_m * alto_m redondeado a 2 decimales.';

-- ----------------------------------------------------------------------------
-- 3. Fotos de inspección (preparado para carga múltiple)
--    Guarda la ruta en Supabase Storage, no el binario.
-- ----------------------------------------------------------------------------
create table if not exists public.inspeccion_fotos (
  id            uuid primary key default gen_random_uuid(),
  inspeccion_id uuid not null references public.inspecciones(id) on delete cascade,
  storage_path  text not null,
  descripcion   text,
  orden         integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists inspeccion_fotos_inspeccion_idx
  on public.inspeccion_fotos(inspeccion_id);

-- ----------------------------------------------------------------------------
-- 4. Historial de cambios de estado (trazabilidad)
--    Solo lo escribe el trigger; sin INSERT directo desde el cliente.
-- ----------------------------------------------------------------------------
create table if not exists public.inspeccion_historial (
  id              uuid primary key default gen_random_uuid(),
  inspeccion_id   uuid not null references public.inspecciones(id) on delete cascade,
  estado_anterior text references public.inspeccion_estados(key),
  estado_nuevo    text not null references public.inspeccion_estados(key),
  nota            text,
  changed_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);

create index if not exists inspeccion_historial_inspeccion_idx
  on public.inspeccion_historial(inspeccion_id);

-- ----------------------------------------------------------------------------
-- 5. Triggers: updated_at + registro automático de historial
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_inspecciones_touch on public.inspecciones;
create trigger trg_inspecciones_touch
  before update on public.inspecciones
  for each row execute function public.touch_updated_at();

create or replace function public.registrar_cambio_estado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.inspeccion_historial (inspeccion_id, estado_anterior, estado_nuevo, changed_by)
    values (new.id, null, new.estado, coalesce(new.created_by, auth.uid()));
  elsif new.estado is distinct from old.estado then
    insert into public.inspeccion_historial (inspeccion_id, estado_anterior, estado_nuevo, changed_by)
    values (new.id, old.estado, new.estado, auth.uid());
  end if;
  return new;
end;
$$;

-- AFTER: la fila padre ya existe cuando se inserta el historial (respeta la FK).
drop trigger if exists trg_inspecciones_historial on public.inspecciones;
create trigger trg_inspecciones_historial
  after insert or update on public.inspecciones
  for each row execute function public.registrar_cambio_estado();

-- ----------------------------------------------------------------------------
-- 6. Row Level Security
-- ----------------------------------------------------------------------------
alter table public.perfiles            enable row level security;
alter table public.inspeccion_estados  enable row level security;
alter table public.inspecciones        enable row level security;
alter table public.inspeccion_fotos    enable row level security;
alter table public.inspeccion_historial enable row level security;

-- Perfiles: cada quien ve/edita el suyo; administrador ve todos.
drop policy if exists perfiles_select_self on public.perfiles;
create policy perfiles_select_self on public.perfiles
  for select to authenticated
  using (user_id = auth.uid() or public.tiene_rol(array['administrador']::public.app_rol[]));

-- Catálogo de estados: lectura pública (no sensible), SIN escritura anónima.
drop policy if exists inspeccion_estados_read on public.inspeccion_estados;
create policy inspeccion_estados_read on public.inspeccion_estados
  for select to anon, authenticated using (true);

-- Inspecciones: lectura autenticada; escritura solo con rol operativo.
drop policy if exists inspecciones_select on public.inspecciones;
create policy inspecciones_select on public.inspecciones
  for select to authenticated using (true);

drop policy if exists inspecciones_insert on public.inspecciones;
create policy inspecciones_insert on public.inspecciones
  for insert to authenticated
  with check (public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[]));

drop policy if exists inspecciones_update on public.inspecciones;
create policy inspecciones_update on public.inspecciones
  for update to authenticated
  using (public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[]))
  with check (public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[]));

-- Fotos: lectura autenticada; escritura con rol operativo.
drop policy if exists inspeccion_fotos_select on public.inspeccion_fotos;
create policy inspeccion_fotos_select on public.inspeccion_fotos
  for select to authenticated using (true);

drop policy if exists inspeccion_fotos_write on public.inspeccion_fotos;
create policy inspeccion_fotos_write on public.inspeccion_fotos
  for all to authenticated
  using (public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[]))
  with check (public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[]));

-- Historial: solo lectura autenticada (lo escribe el trigger, no el cliente).
drop policy if exists inspeccion_historial_select on public.inspeccion_historial;
create policy inspeccion_historial_select on public.inspeccion_historial
  for select to authenticated using (true);

-- ----------------------------------------------------------------------------
-- 7. Grants (RLS + grants: ambos deben permitir la operación)
--    anon NO recibe ningún privilegio de escritura → sin escrituras anónimas.
-- ----------------------------------------------------------------------------
grant select on public.inspeccion_estados to anon, authenticated;

grant select on public.perfiles to authenticated;

grant select, insert, update on public.inspecciones to authenticated;
grant select, insert, update, delete on public.inspeccion_fotos to authenticated;
grant select on public.inspeccion_historial to authenticated;

-- Nota: sin login configurado aún, estas tablas quedan inaccesibles desde el
-- cliente anónimo (comportamiento esperado y seguro). Se activan al conectar
-- Supabase Auth y poblar public.perfiles con los roles correspondientes.
