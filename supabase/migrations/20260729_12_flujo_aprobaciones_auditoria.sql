-- ============================================================================
-- Fase 12 — Flujo administrativo auditable y aprobación obligatoria
-- ----------------------------------------------------------------------------
-- 1. Las transiciones de inspecciones y expedientes se validan en PostgreSQL.
-- 2. Un administrador aplica o resuelve los cambios de estado.
-- 3. Inspectores/coordinadores generan solicitudes pendientes.
-- 4. Los vínculos entre registro administrativo y capa territorial requieren
--    aprobación de administrador.
-- 5. Historiales y solicitudes conservan actor, rol, fundamento y fecha.
--
-- Idempotente. Ejecutar después de las migraciones 02, 06, 08, 10 y 11.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Helper de autorización
-- ----------------------------------------------------------------------------
create or replace function public.es_administrador_o_servicio()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.role(), '') = 'service_role'
    or public.tiene_rol(array['administrador']::public.app_rol[]);
$$;

revoke all on function public.es_administrador_o_servicio() from public;
grant execute on function public.es_administrador_o_servicio() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 1. Catálogos de transiciones permitidas
-- ----------------------------------------------------------------------------
create table if not exists public.inspeccion_transiciones (
  estado_anterior text not null references public.inspeccion_estados(key),
  estado_nuevo    text not null references public.inspeccion_estados(key),
  primary key (estado_anterior, estado_nuevo)
);

insert into public.inspeccion_transiciones (estado_anterior, estado_nuevo) values
  ('nuevo_relevamiento', 'pendiente_revision'),
  ('nuevo_relevamiento', 'inspeccion_programada'),
  ('pendiente_revision', 'inspeccion_programada'),
  ('pendiente_revision', 'derivado_expediente'),
  ('inspeccion_programada', 'inspeccionado'),
  ('inspeccionado', 'regular'),
  ('inspeccionado', 'con_observaciones'),
  ('regular', 'cerrado'),
  ('con_observaciones', 'notificado'),
  ('con_observaciones', 'derivado_expediente'),
  ('notificado', 'en_regularizacion'),
  ('notificado', 'derivado_expediente'),
  ('en_regularizacion', 'regularizado'),
  ('en_regularizacion', 'derivado_expediente'),
  ('derivado_expediente', 'cerrado')
on conflict do nothing;

create table if not exists public.expediente_transiciones (
  estado_anterior text not null references public.expediente_estados(key),
  estado_nuevo    text not null references public.expediente_estados(key),
  primary key (estado_anterior, estado_nuevo)
);

insert into public.expediente_transiciones (estado_anterior, estado_nuevo) values
  ('abierto', 'en_tramite'),
  ('abierto', 'archivado'),
  ('en_tramite', 'notificado'),
  ('en_tramite', 'resuelto'),
  ('en_tramite', 'archivado'),
  ('notificado', 'en_tramite'),
  ('notificado', 'resuelto'),
  ('notificado', 'archivado'),
  ('resuelto', 'archivado')
on conflict do nothing;

alter table public.inspeccion_transiciones enable row level security;
alter table public.expediente_transiciones enable row level security;

drop policy if exists inspeccion_transiciones_select on public.inspeccion_transiciones;
create policy inspeccion_transiciones_select on public.inspeccion_transiciones
  for select to authenticated using (true);

drop policy if exists expediente_transiciones_select on public.expediente_transiciones;
create policy expediente_transiciones_select on public.expediente_transiciones
  for select to authenticated using (true);

grant select on public.inspeccion_transiciones to authenticated;
grant select on public.expediente_transiciones to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Solicitudes de cambio de estado
-- ----------------------------------------------------------------------------
create table if not exists public.cambio_estado_solicitudes (
  id                 uuid primary key default gen_random_uuid(),
  entidad            text not null check (entidad in ('inspeccion', 'expediente')),
  inspeccion_id      uuid references public.inspecciones(id) on delete cascade,
  expediente_id      uuid references public.expedientes(id) on delete cascade,
  estado_anterior    text not null,
  estado_solicitado  text not null,
  fundamento         text not null check (char_length(btrim(fundamento)) >= 5),
  estado             text not null default 'pendiente'
                       check (estado in ('pendiente', 'aprobada', 'rechazada', 'cancelada')),
  solicitado_por     uuid not null references auth.users(id),
  solicitante_nombre text,
  solicitante_rol    public.app_rol,
  resuelto_por       uuid references auth.users(id),
  resolutor_nombre   text,
  resolutor_rol      public.app_rol,
  nota_resolucion    text,
  created_at         timestamptz not null default now(),
  resolved_at        timestamptz,
  check (
    (entidad = 'inspeccion' and inspeccion_id is not null and expediente_id is null)
    or
    (entidad = 'expediente' and expediente_id is not null and inspeccion_id is null)
  )
);

create unique index if not exists cambio_estado_pendiente_inspeccion_uidx
  on public.cambio_estado_solicitudes(inspeccion_id)
  where estado = 'pendiente' and inspeccion_id is not null;

create unique index if not exists cambio_estado_pendiente_expediente_uidx
  on public.cambio_estado_solicitudes(expediente_id)
  where estado = 'pendiente' and expediente_id is not null;

create index if not exists cambio_estado_solicitudes_estado_idx
  on public.cambio_estado_solicitudes(estado, created_at desc);

alter table public.cambio_estado_solicitudes enable row level security;

drop policy if exists cambio_estado_solicitudes_select on public.cambio_estado_solicitudes;
create policy cambio_estado_solicitudes_select on public.cambio_estado_solicitudes
  for select to authenticated using (true);

revoke all on public.cambio_estado_solicitudes from anon, authenticated;
grant select on public.cambio_estado_solicitudes to authenticated;

-- Solo los RPC de esta migración pueden cambiar estados.
create or replace function public.validar_transicion_inspeccion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado is not distinct from old.estado then
    return new;
  end if;

  if not public.es_administrador_o_servicio()
     or coalesce(current_setting('app.aprobacion_estado', true), '') <> 'inspeccion' then
    raise exception 'El estado de una inspección solo puede cambiarse mediante el flujo de aprobación';
  end if;

  if not exists (
    select 1 from public.inspeccion_transiciones t
    where t.estado_anterior = old.estado and t.estado_nuevo = new.estado
  ) then
    raise exception 'Transición de inspección no permitida: % -> %', old.estado, new.estado;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_inspecciones_validar_transicion on public.inspecciones;
create trigger trg_inspecciones_validar_transicion
  before update of estado on public.inspecciones
  for each row execute function public.validar_transicion_inspeccion();

create or replace function public.validar_transicion_expediente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado is not distinct from old.estado then
    return new;
  end if;

  if not public.es_administrador_o_servicio()
     or coalesce(current_setting('app.aprobacion_estado', true), '') <> 'expediente' then
    raise exception 'El estado de un expediente solo puede cambiarse mediante el flujo de aprobación';
  end if;

  if not exists (
    select 1 from public.expediente_transiciones t
    where t.estado_anterior = old.estado and t.estado_nuevo = new.estado
  ) then
    raise exception 'Transición de expediente no permitida: % -> %', old.estado, new.estado;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_expedientes_validar_transicion on public.expedientes;
create trigger trg_expedientes_validar_transicion
  before update of estado on public.expedientes
  for each row execute function public.validar_transicion_expediente();

create or replace function public.solicitar_cambio_estado_inspeccion(
  p_inspeccion_id uuid,
  p_estado_nuevo text,
  p_fundamento text
)
returns table (resultado text, solicitud_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado_actual text;
  v_solicitud_id uuid;
  v_nombre text;
  v_rol public.app_rol;
begin
  if auth.uid() is null
     or not public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[]) then
    raise exception 'No autorizado';
  end if;
  if char_length(btrim(coalesce(p_fundamento, ''))) < 5 then
    raise exception 'El fundamento debe tener al menos 5 caracteres';
  end if;

  select estado into v_estado_actual
  from public.inspecciones where id = p_inspeccion_id for update;
  if v_estado_actual is null then raise exception 'Inspección inexistente'; end if;

  if not exists (
    select 1 from public.inspeccion_transiciones
    where estado_anterior = v_estado_actual and estado_nuevo = p_estado_nuevo
  ) then
    raise exception 'Transición de inspección no permitida';
  end if;

  select nombre, rol into v_nombre, v_rol
  from public.perfiles where user_id = auth.uid();

  if public.tiene_rol(array['administrador']::public.app_rol[]) then
    perform set_config('app.aprobacion_estado', 'inspeccion', true);
    update public.inspecciones set estado = p_estado_nuevo where id = p_inspeccion_id;
    insert into public.cambio_estado_solicitudes (
      entidad, inspeccion_id, estado_anterior, estado_solicitado, fundamento,
      estado, solicitado_por, solicitante_nombre, solicitante_rol,
      resuelto_por, resolutor_nombre, resolutor_rol, nota_resolucion, resolved_at
    ) values (
      'inspeccion', p_inspeccion_id, v_estado_actual, p_estado_nuevo, btrim(p_fundamento),
      'aprobada', auth.uid(), v_nombre, v_rol,
      auth.uid(), v_nombre, v_rol, 'Aprobación directa del administrador', now()
    ) returning id into v_solicitud_id;
    return query select 'aplicado'::text, v_solicitud_id;
    return;
  end if;

  insert into public.cambio_estado_solicitudes (
    entidad, inspeccion_id, estado_anterior, estado_solicitado, fundamento,
    solicitado_por, solicitante_nombre, solicitante_rol
  ) values (
    'inspeccion', p_inspeccion_id, v_estado_actual, p_estado_nuevo, btrim(p_fundamento),
    auth.uid(), v_nombre, v_rol
  )
  on conflict do nothing
  returning id into v_solicitud_id;

  if v_solicitud_id is null then
    select id into v_solicitud_id from public.cambio_estado_solicitudes
    where inspeccion_id = p_inspeccion_id and estado = 'pendiente';
  end if;
  return query select 'pendiente'::text, v_solicitud_id;
end;
$$;

create or replace function public.solicitar_cambio_estado_expediente(
  p_expediente_id uuid,
  p_estado_nuevo text,
  p_fundamento text
)
returns table (resultado text, solicitud_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado_actual text;
  v_solicitud_id uuid;
  v_nombre text;
  v_rol public.app_rol;
begin
  if auth.uid() is null
     or not public.tiene_rol(array['administrador','coordinador']::public.app_rol[]) then
    raise exception 'No autorizado';
  end if;
  if char_length(btrim(coalesce(p_fundamento, ''))) < 5 then
    raise exception 'El fundamento debe tener al menos 5 caracteres';
  end if;

  select estado into v_estado_actual
  from public.expedientes where id = p_expediente_id for update;
  if v_estado_actual is null then raise exception 'Expediente inexistente'; end if;

  if not exists (
    select 1 from public.expediente_transiciones
    where estado_anterior = v_estado_actual and estado_nuevo = p_estado_nuevo
  ) then
    raise exception 'Transición de expediente no permitida';
  end if;

  select nombre, rol into v_nombre, v_rol
  from public.perfiles where user_id = auth.uid();

  if public.tiene_rol(array['administrador']::public.app_rol[]) then
    perform set_config('app.aprobacion_estado', 'expediente', true);
    update public.expedientes set estado = p_estado_nuevo where id = p_expediente_id;
    insert into public.cambio_estado_solicitudes (
      entidad, expediente_id, estado_anterior, estado_solicitado, fundamento,
      estado, solicitado_por, solicitante_nombre, solicitante_rol,
      resuelto_por, resolutor_nombre, resolutor_rol, nota_resolucion, resolved_at
    ) values (
      'expediente', p_expediente_id, v_estado_actual, p_estado_nuevo, btrim(p_fundamento),
      'aprobada', auth.uid(), v_nombre, v_rol,
      auth.uid(), v_nombre, v_rol, 'Aprobación directa del administrador', now()
    ) returning id into v_solicitud_id;
    return query select 'aplicado'::text, v_solicitud_id;
    return;
  end if;

  insert into public.cambio_estado_solicitudes (
    entidad, expediente_id, estado_anterior, estado_solicitado, fundamento,
    solicitado_por, solicitante_nombre, solicitante_rol
  ) values (
    'expediente', p_expediente_id, v_estado_actual, p_estado_nuevo, btrim(p_fundamento),
    auth.uid(), v_nombre, v_rol
  )
  on conflict do nothing
  returning id into v_solicitud_id;

  if v_solicitud_id is null then
    select id into v_solicitud_id from public.cambio_estado_solicitudes
    where expediente_id = p_expediente_id and estado = 'pendiente';
  end if;
  return query select 'pendiente'::text, v_solicitud_id;
end;
$$;

create or replace function public.resolver_solicitud_cambio_estado(
  p_solicitud_id uuid,
  p_aprobar boolean,
  p_nota text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_solicitud public.cambio_estado_solicitudes%rowtype;
  v_estado_actual text;
  v_nombre text;
  v_rol public.app_rol;
begin
  if auth.uid() is null or not public.tiene_rol(array['administrador']::public.app_rol[]) then
    raise exception 'Solo un administrador puede resolver solicitudes';
  end if;
  if char_length(btrim(coalesce(p_nota, ''))) < 5 then
    raise exception 'La resolución debe tener al menos 5 caracteres';
  end if;

  select * into v_solicitud
  from public.cambio_estado_solicitudes
  where id = p_solicitud_id and estado = 'pendiente'
  for update;
  if v_solicitud.id is null then raise exception 'Solicitud pendiente inexistente'; end if;

  select nombre, rol into v_nombre, v_rol
  from public.perfiles where user_id = auth.uid();

  if p_aprobar then
    if v_solicitud.entidad = 'inspeccion' then
      select estado into v_estado_actual from public.inspecciones
      where id = v_solicitud.inspeccion_id for update;
      if v_estado_actual is distinct from v_solicitud.estado_anterior then
        raise exception 'La inspección cambió desde que se creó la solicitud';
      end if;
      perform set_config('app.aprobacion_estado', 'inspeccion', true);
      update public.inspecciones
      set estado = v_solicitud.estado_solicitado
      where id = v_solicitud.inspeccion_id;
    else
      select estado into v_estado_actual from public.expedientes
      where id = v_solicitud.expediente_id for update;
      if v_estado_actual is distinct from v_solicitud.estado_anterior then
        raise exception 'El expediente cambió desde que se creó la solicitud';
      end if;
      perform set_config('app.aprobacion_estado', 'expediente', true);
      update public.expedientes
      set estado = v_solicitud.estado_solicitado
      where id = v_solicitud.expediente_id;
    end if;
  end if;

  update public.cambio_estado_solicitudes
  set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
      resuelto_por = auth.uid(),
      resolutor_nombre = v_nombre,
      resolutor_rol = v_rol,
      nota_resolucion = btrim(p_nota),
      resolved_at = now()
  where id = p_solicitud_id;

  return true;
end;
$$;

revoke all on function public.solicitar_cambio_estado_inspeccion(uuid, text, text) from public;
revoke all on function public.solicitar_cambio_estado_expediente(uuid, text, text) from public;
revoke all on function public.resolver_solicitud_cambio_estado(uuid, boolean, text) from public;
grant execute on function public.solicitar_cambio_estado_inspeccion(uuid, text, text) to authenticated;
grant execute on function public.solicitar_cambio_estado_expediente(uuid, text, text) to authenticated;
grant execute on function public.resolver_solicitud_cambio_estado(uuid, boolean, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Actor y rol en los historiales existentes
-- ----------------------------------------------------------------------------
alter table public.inspeccion_historial
  add column if not exists changed_by_nombre text,
  add column if not exists changed_by_rol public.app_rol;

alter table public.expediente_historial
  add column if not exists changed_by_nombre text,
  add column if not exists changed_by_rol public.app_rol;

create or replace function public.registrar_cambio_estado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_nombre text;
  v_rol public.app_rol;
begin
  v_actor := case when tg_op = 'INSERT' then coalesce(new.created_by, auth.uid()) else auth.uid() end;
  select nombre, rol into v_nombre, v_rol from public.perfiles where user_id = v_actor;
  if tg_op = 'INSERT' then
    insert into public.inspeccion_historial (
      inspeccion_id, estado_anterior, estado_nuevo, changed_by,
      changed_by_nombre, changed_by_rol
    ) values (new.id, null, new.estado, v_actor, v_nombre, v_rol);
  elsif new.estado is distinct from old.estado then
    insert into public.inspeccion_historial (
      inspeccion_id, estado_anterior, estado_nuevo, changed_by,
      changed_by_nombre, changed_by_rol
    ) values (new.id, old.estado, new.estado, v_actor, v_nombre, v_rol);
  end if;
  return new;
end;
$$;

create or replace function public.registrar_cambio_estado_expediente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_nombre text;
  v_rol public.app_rol;
begin
  v_actor := case when tg_op = 'INSERT' then coalesce(new.created_by, auth.uid()) else auth.uid() end;
  select nombre, rol into v_nombre, v_rol from public.perfiles where user_id = v_actor;
  if tg_op = 'INSERT' then
    insert into public.expediente_historial (
      expediente_id, estado_anterior, estado_nuevo, changed_by,
      changed_by_nombre, changed_by_rol
    ) values (new.id, null, new.estado, v_actor, v_nombre, v_rol);
  elsif new.estado is distinct from old.estado then
    insert into public.expediente_historial (
      expediente_id, estado_anterior, estado_nuevo, changed_by,
      changed_by_nombre, changed_by_rol
    ) values (new.id, old.estado, new.estado, v_actor, v_nombre, v_rol);
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Aprobación del vínculo territorial ↔ registro administrativo
-- ----------------------------------------------------------------------------
alter table public.carteles
  add column if not exists territorial_feature_id_propuesto text,
  add column if not exists vinculo_estado text not null default 'sin_vinculo',
  add column if not exists vinculo_solicitado_por uuid references auth.users(id),
  add column if not exists vinculo_solicitado_en timestamptz,
  add column if not exists vinculo_aprobado_por uuid references auth.users(id),
  add column if not exists vinculo_aprobado_en timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'carteles_vinculo_estado_check'
      and conrelid = 'public.carteles'::regclass
  ) then
    alter table public.carteles add constraint carteles_vinculo_estado_check
      check (vinculo_estado in ('sin_vinculo', 'pendiente', 'aprobado', 'rechazado'));
  end if;
end $$;

update public.carteles
set vinculo_estado = 'aprobado',
    vinculo_aprobado_en = coalesce(vinculo_aprobado_en, updated_at, created_at)
where territorial_feature_id is not null
  and vinculo_estado is distinct from 'aprobado';

create unique index if not exists carteles_vinculo_propuesto_pendiente_uidx
  on public.carteles(territorial_feature_id_propuesto)
  where vinculo_estado = 'pendiente' and territorial_feature_id_propuesto is not null;

create table if not exists public.cartel_vinculo_historial (
  id                     uuid primary key default gen_random_uuid(),
  cartel_id              text not null references public.carteles(id) on delete cascade,
  territorial_feature_id text not null,
  accion                 text not null check (accion in ('solicitado', 'aprobado', 'rechazado')),
  fundamento             text,
  actor_id                uuid references auth.users(id),
  actor_nombre            text,
  actor_rol               public.app_rol,
  created_at              timestamptz not null default now()
);

create index if not exists cartel_vinculo_historial_cartel_idx
  on public.cartel_vinculo_historial(cartel_id, created_at);

alter table public.cartel_vinculo_historial enable row level security;
drop policy if exists cartel_vinculo_historial_select on public.cartel_vinculo_historial;
create policy cartel_vinculo_historial_select on public.cartel_vinculo_historial
  for select to authenticated using (true);
revoke all on public.cartel_vinculo_historial from anon, authenticated;
grant select on public.cartel_vinculo_historial to authenticated;

create or replace function public.preparar_vinculo_cartel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
  v_rol public.app_rol;
begin
  if tg_op = 'INSERT' and new.territorial_feature_id is not null then
    select nombre, rol into v_nombre, v_rol from public.perfiles where user_id = auth.uid();
    if public.es_administrador_o_servicio() then
      new.vinculo_estado := 'aprobado';
      new.vinculo_aprobado_por := auth.uid();
      new.vinculo_aprobado_en := now();
    else
      new.territorial_feature_id_propuesto := new.territorial_feature_id;
      new.territorial_feature_id := null;
      new.vinculo_estado := 'pendiente';
      new.vinculo_solicitado_por := auth.uid();
      new.vinculo_solicitado_en := now();
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and (
    new.territorial_feature_id is distinct from old.territorial_feature_id
    or new.territorial_feature_id_propuesto is distinct from old.territorial_feature_id_propuesto
    or new.vinculo_estado is distinct from old.vinculo_estado
  ) and (
    not public.es_administrador_o_servicio()
    or coalesce(current_setting('app.aprobacion_vinculo', true), '') <> 'true'
  ) then
    raise exception 'El vínculo territorial solo puede cambiarse mediante el flujo de aprobación';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_carteles_preparar_vinculo on public.carteles;
create trigger trg_carteles_preparar_vinculo
  before insert or update on public.carteles
  for each row execute function public.preparar_vinculo_cartel();

create or replace function public.registrar_alta_vinculo_cartel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_feature_id text;
  v_accion text;
  v_nombre text;
  v_rol public.app_rol;
begin
  v_feature_id := coalesce(new.territorial_feature_id, new.territorial_feature_id_propuesto);
  if v_feature_id is null then return new; end if;
  v_accion := case when new.vinculo_estado = 'aprobado' then 'aprobado' else 'solicitado' end;
  select nombre, rol into v_nombre, v_rol from public.perfiles where user_id = auth.uid();
  insert into public.cartel_vinculo_historial (
    cartel_id, territorial_feature_id, accion, fundamento,
    actor_id, actor_nombre, actor_rol
  ) values (
    new.id, v_feature_id, v_accion,
    case when v_accion = 'aprobado' then 'Aprobación directa del administrador' else 'Alta desde la ficha territorial' end,
    auth.uid(), v_nombre, v_rol
  );
  return new;
end;
$$;

drop trigger if exists trg_carteles_historial_vinculo_alta on public.carteles;
create trigger trg_carteles_historial_vinculo_alta
  after insert on public.carteles
  for each row execute function public.registrar_alta_vinculo_cartel();

create or replace function public.resolver_vinculo_cartel(
  p_cartel_id text,
  p_aprobar boolean,
  p_fundamento text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cartel public.carteles%rowtype;
  v_nombre text;
  v_rol public.app_rol;
begin
  if auth.uid() is null or not public.tiene_rol(array['administrador']::public.app_rol[]) then
    raise exception 'Solo un administrador puede resolver vínculos';
  end if;
  if char_length(btrim(coalesce(p_fundamento, ''))) < 5 then
    raise exception 'El fundamento debe tener al menos 5 caracteres';
  end if;

  select * into v_cartel from public.carteles
  where id = p_cartel_id and vinculo_estado = 'pendiente'
  for update;
  if v_cartel.id is null then raise exception 'Vínculo pendiente inexistente'; end if;

  select nombre, rol into v_nombre, v_rol from public.perfiles where user_id = auth.uid();
  perform set_config('app.aprobacion_vinculo', 'true', true);

  if p_aprobar then
    update public.carteles
    set territorial_feature_id = v_cartel.territorial_feature_id_propuesto,
        territorial_feature_id_propuesto = null,
        vinculo_estado = 'aprobado',
        vinculo_aprobado_por = auth.uid(),
        vinculo_aprobado_en = now()
    where id = p_cartel_id;
  else
    update public.carteles
    set territorial_feature_id = null,
        territorial_feature_id_propuesto = null,
        vinculo_estado = 'rechazado'
    where id = p_cartel_id;
  end if;

  insert into public.cartel_vinculo_historial (
    cartel_id, territorial_feature_id, accion, fundamento,
    actor_id, actor_nombre, actor_rol
  ) values (
    p_cartel_id, v_cartel.territorial_feature_id_propuesto,
    case when p_aprobar then 'aprobado' else 'rechazado' end,
    btrim(p_fundamento), auth.uid(), v_nombre, v_rol
  );

  return true;
end;
$$;

revoke all on function public.resolver_vinculo_cartel(text, boolean, text) from public;
grant execute on function public.resolver_vinculo_cartel(text, boolean, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Bitácora inmutable y conservación de evidencia
-- ----------------------------------------------------------------------------
create table if not exists public.auditoria_eventos (
  id             bigint generated always as identity primary key,
  entidad        text not null,
  entidad_id     text not null,
  accion         text not null check (accion in ('insert', 'update', 'delete')),
  datos_anteriores jsonb,
  datos_nuevos     jsonb,
  actor_id       uuid references auth.users(id),
  actor_nombre   text,
  actor_rol      public.app_rol,
  created_at     timestamptz not null default now()
);

create index if not exists auditoria_eventos_entidad_idx
  on public.auditoria_eventos(entidad, entidad_id, created_at desc);

alter table public.auditoria_eventos enable row level security;
drop policy if exists auditoria_eventos_select_admin on public.auditoria_eventos;
create policy auditoria_eventos_select_admin on public.auditoria_eventos
  for select to authenticated
  using (public.tiene_rol(array['administrador']::public.app_rol[]));

revoke all on public.auditoria_eventos from anon, authenticated;
grant select on public.auditoria_eventos to authenticated;

create or replace function public.registrar_auditoria_evento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_nombre text;
  v_rol public.app_rol;
  v_entidad_id text;
begin
  v_actor := auth.uid();
  select nombre, rol into v_nombre, v_rol from public.perfiles where user_id = v_actor;
  v_entidad_id := case
    when tg_op = 'DELETE' then old.id::text
    else new.id::text
  end;

  insert into public.auditoria_eventos (
    entidad, entidad_id, accion, datos_anteriores, datos_nuevos,
    actor_id, actor_nombre, actor_rol
  ) values (
    tg_table_name,
    v_entidad_id,
    lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
    v_actor,
    v_nombre,
    v_rol
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auditar_carteles on public.carteles;
create trigger trg_auditar_carteles
  after insert or update or delete on public.carteles
  for each row execute function public.registrar_auditoria_evento();

drop trigger if exists trg_auditar_inspecciones on public.inspecciones;
create trigger trg_auditar_inspecciones
  after insert or update or delete on public.inspecciones
  for each row execute function public.registrar_auditoria_evento();

drop trigger if exists trg_auditar_inspeccion_fotos on public.inspeccion_fotos;
create trigger trg_auditar_inspeccion_fotos
  after insert or update or delete on public.inspeccion_fotos
  for each row execute function public.registrar_auditoria_evento();

drop trigger if exists trg_auditar_expedientes on public.expedientes;
create trigger trg_auditar_expedientes
  after insert or update or delete on public.expedientes
  for each row execute function public.registrar_auditoria_evento();

drop trigger if exists trg_auditar_expediente_documentos on public.expediente_documentos;
create trigger trg_auditar_expediente_documentos
  after insert or update or delete on public.expediente_documentos
  for each row execute function public.registrar_auditoria_evento();

drop trigger if exists trg_auditar_solicitudes_estado on public.cambio_estado_solicitudes;
create trigger trg_auditar_solicitudes_estado
  after insert or update or delete on public.cambio_estado_solicitudes
  for each row execute function public.registrar_auditoria_evento();

-- Una actuación administrativa y su evidencia no se eliminan físicamente desde
-- el cliente. Una futura anulación debe modelarse como estado y conservar rastro.
drop policy if exists inspecciones_delete on public.inspecciones;
revoke delete on public.inspecciones from authenticated;

drop policy if exists inspeccion_fotos_write on public.inspeccion_fotos;
drop policy if exists inspeccion_fotos_insert on public.inspeccion_fotos;
create policy inspeccion_fotos_insert on public.inspeccion_fotos
  for insert to authenticated
  with check (public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[]));

drop policy if exists inspeccion_fotos_update on public.inspeccion_fotos;
create policy inspeccion_fotos_update on public.inspeccion_fotos
  for update to authenticated
  using (public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[]))
  with check (public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[]));

revoke delete on public.inspeccion_fotos from authenticated;
drop policy if exists inspeccion_fotos_delete on storage.objects;

drop policy if exists expediente_documentos_write on public.expediente_documentos;
drop policy if exists expediente_documentos_insert on public.expediente_documentos;
create policy expediente_documentos_insert on public.expediente_documentos
  for insert to authenticated
  with check (public.tiene_rol(array['administrador','coordinador']::public.app_rol[]));

drop policy if exists expediente_documentos_update on public.expediente_documentos;
create policy expediente_documentos_update on public.expediente_documentos
  for update to authenticated
  using (public.tiene_rol(array['administrador','coordinador']::public.app_rol[]))
  with check (public.tiene_rol(array['administrador','coordinador']::public.app_rol[]));

revoke delete on public.expediente_documentos from authenticated;
drop policy if exists expediente_docs_delete on storage.objects;
