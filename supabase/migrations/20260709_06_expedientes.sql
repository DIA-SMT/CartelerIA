-- ============================================================================
-- Fase 6 — Expedientes (migración idempotente, RLS por rol)
-- ----------------------------------------------------------------------------
-- Un expediente agrupa, para UN cartel, sus inspecciones + evidencia + historial
-- (rollup por cartel_id) y suma documentos propios y su historial de estados.
-- Decisiones: 1 expediente por cartel (unique cartel_id); escritura solo
-- administrador/coordinador; sin escrituras anónimas.
-- Reusa: enum public.app_rol, public.tiene_rol(app_rol[]), carteles(id text).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Catálogo configurable de estados del expediente
-- ----------------------------------------------------------------------------
create table if not exists public.expediente_estados (
  key        text primary key,
  label      text not null,
  categoria  text not null,
  orden      integer not null default 0,
  color      text not null default '#64748b',
  es_final   boolean not null default false,
  activo     boolean not null default true
);

insert into public.expediente_estados (key, label, categoria, orden, color, es_final) values
  ('abierto',    'Abierto',     'inicial', 10, '#0166FF', false),
  ('en_tramite', 'En trámite',  'proceso', 20, '#6366f1', false),
  ('notificado', 'Notificado',  'proceso', 30, '#f97316', false),
  ('resuelto',   'Resuelto',    'cierre',  40, '#16a34a', true),
  ('archivado',  'Archivado',   'cierre',  50, '#475569', true)
on conflict (key) do update set
  label = excluded.label, categoria = excluded.categoria,
  orden = excluded.orden, color = excluded.color, es_final = excluded.es_final;

-- ----------------------------------------------------------------------------
-- 2. Numeración automática "EXP-{año}-{correlativo}"
-- ----------------------------------------------------------------------------
create sequence if not exists public.expediente_numero_seq;

create or replace function public.generar_numero_expediente()
returns trigger
language plpgsql
as $$
begin
  if new.numero is null then
    new.numero := 'EXP-' || to_char(now(), 'YYYY') || '-'
                  || lpad(nextval('public.expediente_numero_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Expedientes (1 por cartel)
-- ----------------------------------------------------------------------------
create table if not exists public.expedientes (
  id            uuid primary key default gen_random_uuid(),
  numero        text unique,
  cartel_id     text not null unique references public.carteles(id) on delete cascade,
  estado        text not null default 'abierto' references public.expediente_estados(key),
  empresa       text,
  direccion     text,
  observaciones text,
  created_by    uuid references auth.users(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  cerrado_en    timestamptz
);

create index if not exists expedientes_cartel_idx on public.expedientes(cartel_id);
create index if not exists expedientes_estado_idx on public.expedientes(estado);

-- Numeración (BEFORE INSERT).
drop trigger if exists trg_expedientes_numero on public.expedientes;
create trigger trg_expedientes_numero
  before insert on public.expedientes
  for each row execute function public.generar_numero_expediente();

-- updated_at + cerrado_en al pasar a estado final (BEFORE UPDATE).
create or replace function public.expediente_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if new.estado is distinct from old.estado
     and exists (select 1 from public.expediente_estados e where e.key = new.estado and e.es_final) then
    new.cerrado_en := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_expedientes_touch on public.expedientes;
create trigger trg_expedientes_touch
  before update on public.expedientes
  for each row execute function public.expediente_touch();

-- ----------------------------------------------------------------------------
-- 4. Documentos del expediente (resoluciones, notas). Storage: ruta, no binario.
-- ----------------------------------------------------------------------------
create table if not exists public.expediente_documentos (
  id            uuid primary key default gen_random_uuid(),
  expediente_id uuid not null references public.expedientes(id) on delete cascade,
  storage_path  text not null,
  descripcion   text,
  tipo          text,
  created_by    uuid references auth.users(id) default auth.uid(),
  created_at    timestamptz not null default now()
);

create index if not exists expediente_documentos_exp_idx on public.expediente_documentos(expediente_id);

-- ----------------------------------------------------------------------------
-- 5. Historial de estados (solo lo escribe el trigger)
-- ----------------------------------------------------------------------------
create table if not exists public.expediente_historial (
  id              uuid primary key default gen_random_uuid(),
  expediente_id   uuid not null references public.expedientes(id) on delete cascade,
  estado_anterior text references public.expediente_estados(key),
  estado_nuevo    text not null references public.expediente_estados(key),
  nota            text,
  changed_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);

create index if not exists expediente_historial_exp_idx on public.expediente_historial(expediente_id);

create or replace function public.registrar_cambio_estado_expediente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.expediente_historial (expediente_id, estado_anterior, estado_nuevo, changed_by)
    values (new.id, null, new.estado, coalesce(new.created_by, auth.uid()));
  elsif new.estado is distinct from old.estado then
    insert into public.expediente_historial (expediente_id, estado_anterior, estado_nuevo, changed_by)
    values (new.id, old.estado, new.estado, auth.uid());
  end if;
  return new;
end;
$$;

-- AFTER: la fila padre ya existe cuando se inserta el historial (respeta la FK).
drop trigger if exists trg_expedientes_historial on public.expedientes;
create trigger trg_expedientes_historial
  after insert or update on public.expedientes
  for each row execute function public.registrar_cambio_estado_expediente();

-- ----------------------------------------------------------------------------
-- 6. Row Level Security (lectura autenticada; escritura admin/coordinador)
-- ----------------------------------------------------------------------------
alter table public.expediente_estados     enable row level security;
alter table public.expedientes            enable row level security;
alter table public.expediente_documentos  enable row level security;
alter table public.expediente_historial   enable row level security;

drop policy if exists expediente_estados_read on public.expediente_estados;
create policy expediente_estados_read on public.expediente_estados
  for select to authenticated using (true);

drop policy if exists expedientes_select on public.expedientes;
create policy expedientes_select on public.expedientes
  for select to authenticated using (true);

drop policy if exists expedientes_insert on public.expedientes;
create policy expedientes_insert on public.expedientes
  for insert to authenticated
  with check (public.tiene_rol(array['administrador','coordinador']::public.app_rol[]));

drop policy if exists expedientes_update on public.expedientes;
create policy expedientes_update on public.expedientes
  for update to authenticated
  using (public.tiene_rol(array['administrador','coordinador']::public.app_rol[]))
  with check (public.tiene_rol(array['administrador','coordinador']::public.app_rol[]));

drop policy if exists expediente_documentos_select on public.expediente_documentos;
create policy expediente_documentos_select on public.expediente_documentos
  for select to authenticated using (true);

drop policy if exists expediente_documentos_write on public.expediente_documentos;
create policy expediente_documentos_write on public.expediente_documentos
  for all to authenticated
  using (public.tiene_rol(array['administrador','coordinador']::public.app_rol[]))
  with check (public.tiene_rol(array['administrador','coordinador']::public.app_rol[]));

drop policy if exists expediente_historial_select on public.expediente_historial;
create policy expediente_historial_select on public.expediente_historial
  for select to authenticated using (true);

-- ----------------------------------------------------------------------------
-- 7. Grants (sin privilegios para anon ⇒ sin escrituras/lecturas anónimas)
-- ----------------------------------------------------------------------------
grant select on public.expediente_estados to authenticated;
grant select, insert, update on public.expedientes to authenticated;
grant select, insert, update, delete on public.expediente_documentos to authenticated;
grant select on public.expediente_historial to authenticated;

-- ----------------------------------------------------------------------------
-- 8. Storage: bucket privado para documentos del expediente + policies por rol
--    (mismo patrón que inspeccion-fotos, Fase 3).
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expediente-docs', 'expediente-docs', false, 10485760, array['application/pdf', 'image/*'])
on conflict (id) do update set
  public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists expediente_docs_read on storage.objects;
create policy expediente_docs_read on storage.objects
  for select to authenticated
  using (bucket_id = 'expediente-docs');

drop policy if exists expediente_docs_insert on storage.objects;
create policy expediente_docs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'expediente-docs'
    and public.tiene_rol(array['administrador','coordinador']::public.app_rol[])
  );

drop policy if exists expediente_docs_update on storage.objects;
create policy expediente_docs_update on storage.objects
  for update to authenticated
  using (bucket_id = 'expediente-docs' and public.tiene_rol(array['administrador','coordinador']::public.app_rol[]))
  with check (bucket_id = 'expediente-docs' and public.tiene_rol(array['administrador','coordinador']::public.app_rol[]));

drop policy if exists expediente_docs_delete on storage.objects;
create policy expediente_docs_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'expediente-docs' and public.tiene_rol(array['administrador','coordinador']::public.app_rol[]));
