-- ============================================================================
-- Fase 13 - Integridad legal de actuaciones, vinculos y evidencia
-- ----------------------------------------------------------------------------
-- Ejecutar despues de 20260729_12_flujo_aprobaciones_auditoria.sql.
--
-- Objetivos:
--   1. Las actuaciones nacen en su estado inicial, con autor autenticado.
--   2. Solo se actua sobre carteles cuyo vinculo territorial fue aprobado.
--   3. Los vinculos heredados sin aprobador vuelven a ratificacion pendiente.
--   4. Todo vinculo nuevo nace pendiente, incluso si lo carga un administrador
--      o un proceso con service_role.
--   5. Las aprobaciones legales solo las realiza un administrador autenticado,
--      mediante RPC y con fundamento.
--   6. La evidencia y la bitacora son insert-only.
--
-- La migracion es idempotente. No elimina ni normaliza actuaciones existentes.
-- ============================================================================

begin;

-- La auditoria distingue a la persona responsable del rol tecnico que ejecuto
-- la escritura. En evidencia, el manifiesto lo inserta service_role luego de
-- verificar el archivo, pero el actor legal es quien reservo la carga.
alter table public.auditoria_eventos
  add column if not exists ejecutor_auth_role text;

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
  v_ejecutor_auth_role text;
begin
  v_actor := auth.uid();
  if tg_op = 'INSERT'
     and tg_table_name in ('inspeccion_fotos', 'expediente_documentos') then
    v_actor := nullif(to_jsonb(new)->>'created_by', '')::uuid;
  end if;

  select p.nombre, p.rol
  into v_nombre, v_rol
  from public.perfiles p
  where p.user_id = v_actor;

  v_entidad_id := case
    when tg_op = 'DELETE' then old.id::text
    else new.id::text
  end;
  v_ejecutor_auth_role := coalesce(auth.role(), current_user::text);

  insert into public.auditoria_eventos (
    entidad,
    entidad_id,
    accion,
    datos_anteriores,
    datos_nuevos,
    actor_id,
    actor_nombre,
    actor_rol,
    ejecutor_auth_role
  ) values (
    tg_table_name,
    v_entidad_id,
    lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
    v_actor,
    v_nombre,
    v_rol,
    v_ejecutor_auth_role
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on column public.auditoria_eventos.ejecutor_auth_role is
  'Rol JWT o rol PostgreSQL que ejecuto materialmente la escritura auditada.';

-- ----------------------------------------------------------------------------
-- 1. Ratificacion de vinculos heredados sin aprobador identificado
-- ----------------------------------------------------------------------------
-- La migracion 12 marco como aprobados los vinculos preexistentes aunque no
-- existiera una persona aprobadora. Se conserva el feature como propuesta, se
-- retira como vinculo activo y se registra una solicitud de ratificacion sin
-- inventar actor.
do $$
begin
  if exists (
    select 1
    from public.carteles c
    where c.vinculo_estado in ('aprobado', 'pendiente')
      and coalesce(
        nullif(btrim(c.territorial_feature_id), ''),
        nullif(btrim(c.territorial_feature_id_propuesto), '')
      ) is not null
    group by coalesce(
      nullif(btrim(c.territorial_feature_id), ''),
      nullif(btrim(c.territorial_feature_id_propuesto), '')
    )
    having count(*) > 1
  ) then
    raise exception 'Hay features territoriales activos o pendientes en mas de un cartel'
      using hint =
        'Resolver los vinculos duplicados antes de ejecutar la migracion 13.';
  end if;
end
$$;

do $$
begin
  execute 'alter table public.carteles disable trigger trg_carteles_preparar_vinculo';

  begin
    with pendientes_de_ratificacion as (
      update public.carteles
      set territorial_feature_id_propuesto = territorial_feature_id,
          territorial_feature_id = null,
          vinculo_estado = 'pendiente',
          vinculo_solicitado_por = null,
          vinculo_solicitado_en = now(),
          vinculo_aprobado_por = null,
          vinculo_aprobado_en = null
      where vinculo_estado = 'aprobado'
        and territorial_feature_id is not null
        and vinculo_aprobado_por is null
      returning id, territorial_feature_id_propuesto
    )
    insert into public.cartel_vinculo_historial (
      cartel_id,
      territorial_feature_id,
      accion,
      fundamento,
      actor_id,
      actor_nombre,
      actor_rol
    )
    select
      p.id,
      p.territorial_feature_id_propuesto,
      'solicitado',
      'Ratificacion administrativa requerida para vinculo heredado sin aprobador identificado',
      null,
      null,
      null
    from pendientes_de_ratificacion p;

    -- La RPC de la fase 12 limpiaba la propuesta al rechazarla. Cuando existe
    -- historial, se recupera el feature para que el rechazo conserve su
    -- antecedente bajo el contrato nuevo.
    with rechazos_heredados as (
      select
        c.id,
        (
          select h.territorial_feature_id
          from public.cartel_vinculo_historial h
          where h.cartel_id = c.id
            and h.accion = 'rechazado'
          order by h.created_at desc, h.id desc
          limit 1
        ) as territorial_feature_id,
        (
          select h.created_at
          from public.cartel_vinculo_historial h
          where h.cartel_id = c.id
            and h.accion = 'rechazado'
          order by h.created_at desc, h.id desc
          limit 1
        ) as solicitado_en
      from public.carteles c
      where c.vinculo_estado = 'rechazado'
        and nullif(btrim(c.territorial_feature_id_propuesto), '') is null
    )
    update public.carteles c
    set territorial_feature_id = null,
        territorial_feature_id_propuesto = r.territorial_feature_id,
        vinculo_solicitado_en = coalesce(c.vinculo_solicitado_en, r.solicitado_en),
        vinculo_aprobado_por = null,
        vinculo_aprobado_en = null
    from rechazos_heredados r
    where c.id = r.id
      and nullif(btrim(r.territorial_feature_id), '') is not null;

    -- Si una base heredada no conserva historial recuperable, no se inventa
    -- una propuesta: queda explícitamente sin vínculo y el rechazo histórico,
    -- si existiera, permanece en la bitácora.
    update public.carteles
    set territorial_feature_id = null,
        territorial_feature_id_propuesto = null,
        vinculo_estado = 'sin_vinculo',
        vinculo_solicitado_por = null,
        vinculo_solicitado_en = null,
        vinculo_aprobado_por = null,
        vinculo_aprobado_en = null
    where vinculo_estado = 'rechazado'
      and nullif(btrim(territorial_feature_id_propuesto), '') is null;
  exception
    when others then
      execute 'alter table public.carteles enable trigger trg_carteles_preparar_vinculo';
      raise;
  end;

  execute 'alter table public.carteles enable trigger trg_carteles_preparar_vinculo';
end
$$;

-- Un feature no puede estar activo o pendiente en dos carteles distintos.
-- Las propuestas rechazadas se conservan como antecedente, pero no reservan el
-- feature: una nueva postulacion valida puede volver a utilizarlo.
create unique index if not exists carteles_feature_activo_o_pendiente_uidx
  on public.carteles ((coalesce(territorial_feature_id, territorial_feature_id_propuesto)))
  where vinculo_estado in ('aprobado', 'pendiente')
    and coalesce(territorial_feature_id, territorial_feature_id_propuesto) is not null;

alter table public.carteles
  drop constraint if exists carteles_vinculo_integridad_check;

alter table public.carteles
  add constraint carteles_vinculo_integridad_check
  check (
    case vinculo_estado
      when 'sin_vinculo' then
        territorial_feature_id is null
        and territorial_feature_id_propuesto is null
        and vinculo_solicitado_por is null
        and vinculo_solicitado_en is null
        and vinculo_aprobado_por is null
        and vinculo_aprobado_en is null
      when 'pendiente' then
        territorial_feature_id is null
        and nullif(btrim(territorial_feature_id_propuesto), '') is not null
        and vinculo_solicitado_en is not null
        and vinculo_aprobado_por is null
        and vinculo_aprobado_en is null
      when 'aprobado' then
        nullif(btrim(territorial_feature_id), '') is not null
        and territorial_feature_id_propuesto is null
        and vinculo_aprobado_por is not null
        and vinculo_aprobado_en is not null
      when 'rechazado' then
        territorial_feature_id is null
        and nullif(btrim(territorial_feature_id_propuesto), '') is not null
        and vinculo_solicitado_en is not null
        and vinculo_aprobado_por is null
        and vinculo_aprobado_en is null
      else false
    end
  );

-- Helper interno usado por triggers y RPCs de actuaciones.
create or replace function public.cartel_tiene_vinculo_aprobado(p_cartel_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.carteles c
    where c.id = p_cartel_id
      and c.vinculo_estado = 'aprobado'
      and nullif(btrim(c.territorial_feature_id), '') is not null
      and c.territorial_feature_id_propuesto is null
      and c.vinculo_aprobado_por is not null
      and c.vinculo_aprobado_en is not null
  );
$$;

revoke all on function public.cartel_tiene_vinculo_aprobado(text) from public;
grant execute on function public.cartel_tiene_vinculo_aprobado(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Flujo unico para proponer y resolver vinculos
-- ----------------------------------------------------------------------------
create or replace function public.preparar_vinculo_cartel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_feature_id text;
  v_modo text;
begin
  if tg_op = 'INSERT' then
    if new.territorial_feature_id is not null
       and nullif(btrim(new.territorial_feature_id), '') is null then
      raise exception 'El identificador territorial no puede estar vacio';
    end if;
    if new.territorial_feature_id_propuesto is not null
       and nullif(btrim(new.territorial_feature_id_propuesto), '') is null then
      raise exception 'El identificador territorial propuesto no puede estar vacio';
    end if;
    if new.territorial_feature_id is not null
       and new.territorial_feature_id_propuesto is not null
       and btrim(new.territorial_feature_id) is distinct from btrim(new.territorial_feature_id_propuesto) then
      raise exception 'No se pueden informar dos identificadores territoriales distintos en el alta';
    end if;

    v_feature_id := coalesce(
      nullif(btrim(new.territorial_feature_id), ''),
      nullif(btrim(new.territorial_feature_id_propuesto), '')
    );

    if v_feature_id is null then
      new.territorial_feature_id := null;
      new.territorial_feature_id_propuesto := null;
      new.vinculo_estado := 'sin_vinculo';
      new.vinculo_solicitado_por := null;
      new.vinculo_solicitado_en := null;
      new.vinculo_aprobado_por := null;
      new.vinculo_aprobado_en := null;
      return new;
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_feature_id, 1301));
    if exists (
      select 1
      from public.carteles c
      where c.vinculo_estado in ('aprobado', 'pendiente')
        and coalesce(c.territorial_feature_id, c.territorial_feature_id_propuesto) = v_feature_id
    ) then
      raise exception 'El feature territorial % ya esta activo o pendiente en otro cartel', v_feature_id;
    end if;

    -- Ningun rol obtiene aprobacion por el solo hecho de crear la fila.
    new.territorial_feature_id := null;
    new.territorial_feature_id_propuesto := v_feature_id;
    new.vinculo_estado := 'pendiente';
    new.vinculo_solicitado_por := auth.uid();
    new.vinculo_solicitado_en := now();
    new.vinculo_aprobado_por := null;
    new.vinculo_aprobado_en := null;
    return new;
  end if;

  if new.territorial_feature_id is not distinct from old.territorial_feature_id
     and new.territorial_feature_id_propuesto is not distinct from old.territorial_feature_id_propuesto
     and new.vinculo_estado is not distinct from old.vinculo_estado
     and new.vinculo_solicitado_por is not distinct from old.vinculo_solicitado_por
     and new.vinculo_solicitado_en is not distinct from old.vinculo_solicitado_en
     and new.vinculo_aprobado_por is not distinct from old.vinculo_aprobado_por
     and new.vinculo_aprobado_en is not distinct from old.vinculo_aprobado_en then
    return new;
  end if;

  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' then
    raise exception 'Un proceso tecnico no puede crear ni resolver un vinculo legal';
  end if;

  v_modo := coalesce(current_setting('app.flujo_vinculo', true), '');
  if v_modo not in ('solicitar', 'resolver') then
    raise exception 'El vinculo territorial solo puede cambiarse mediante el flujo administrativo';
  end if;

  if v_modo = 'solicitar' then
    if not public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[]) then
      raise exception 'No autorizado para solicitar vinculos';
    end if;

    v_feature_id := nullif(btrim(new.territorial_feature_id_propuesto), '');
    if v_feature_id is null then
      raise exception 'La solicitud debe incluir un feature territorial';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_feature_id, 1301));
    if exists (
      select 1
      from public.carteles c
      where c.id <> old.id
        and c.vinculo_estado in ('aprobado', 'pendiente')
        and coalesce(c.territorial_feature_id, c.territorial_feature_id_propuesto) = v_feature_id
    ) then
      raise exception 'El feature territorial % ya esta activo o pendiente en otro cartel', v_feature_id;
    end if;

    new.territorial_feature_id := null;
    new.territorial_feature_id_propuesto := v_feature_id;
    new.vinculo_estado := 'pendiente';
    new.vinculo_solicitado_por := auth.uid();
    new.vinculo_solicitado_en := now();
    new.vinculo_aprobado_por := null;
    new.vinculo_aprobado_en := null;
    return new;
  end if;

  if not public.tiene_rol(array['administrador']::public.app_rol[]) then
    raise exception 'Solo un administrador puede resolver vinculos';
  end if;
  if old.vinculo_estado <> 'pendiente'
     or nullif(btrim(old.territorial_feature_id_propuesto), '') is null then
    raise exception 'Vinculo pendiente inexistente';
  end if;

  -- El actor y las fechas se derivan de la sesion; nunca se aceptan del cliente.
  new.vinculo_solicitado_por := old.vinculo_solicitado_por;
  new.vinculo_solicitado_en := old.vinculo_solicitado_en;

  if new.vinculo_estado = 'aprobado' then
    v_feature_id := btrim(old.territorial_feature_id_propuesto);
    if new.territorial_feature_id is distinct from v_feature_id
       or new.territorial_feature_id_propuesto is not null then
      raise exception 'Metadatos inconsistentes al aprobar el vinculo';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_feature_id, 1301));
    if exists (
      select 1
      from public.carteles c
      where c.id <> old.id
        and c.vinculo_estado in ('aprobado', 'pendiente')
        and coalesce(c.territorial_feature_id, c.territorial_feature_id_propuesto) = v_feature_id
    ) then
      raise exception 'El feature territorial % ya esta activo o pendiente en otro cartel', v_feature_id;
    end if;

    new.vinculo_aprobado_por := auth.uid();
    new.vinculo_aprobado_en := now();
    return new;
  end if;

  if new.vinculo_estado = 'rechazado' then
    if new.territorial_feature_id is not null
       or new.territorial_feature_id_propuesto is distinct from old.territorial_feature_id_propuesto then
      raise exception 'El rechazo debe conservar la propuesta territorial como antecedente';
    end if;
    new.vinculo_aprobado_por := null;
    new.vinculo_aprobado_en := null;
    return new;
  end if;

  raise exception 'Resolucion de vinculo invalida';
end;
$$;

drop trigger if exists trg_carteles_preparar_vinculo on public.carteles;
create trigger trg_carteles_preparar_vinculo
  before insert or update on public.carteles
  for each row execute function public.preparar_vinculo_cartel();

-- Solicita, repostula o corrige un vinculo. El lock de fila mas el advisory
-- lock por feature evita carreras entre dos carteles concurrentes.
create or replace function public.solicitar_vinculo_cartel(
  p_cartel_id text,
  p_territorial_feature_id text,
  p_fundamento text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cartel public.carteles%rowtype;
  v_feature_id text;
  v_nombre text;
  v_rol public.app_rol;
begin
  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or not public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[]) then
    raise exception 'No autorizado para solicitar vinculos';
  end if;
  if nullif(btrim(coalesce(p_cartel_id, '')), '') is null then
    raise exception 'El cartel es obligatorio';
  end if;

  v_feature_id := nullif(btrim(coalesce(p_territorial_feature_id, '')), '');
  if v_feature_id is null then
    raise exception 'El feature territorial es obligatorio';
  end if;
  if char_length(btrim(coalesce(p_fundamento, ''))) < 5 then
    raise exception 'El fundamento debe tener al menos 5 caracteres';
  end if;

  select *
  into v_cartel
  from public.carteles c
  where c.id = p_cartel_id
  for update;
  if not found then
    raise exception 'Cartel inexistente';
  end if;

  if v_cartel.vinculo_estado = 'pendiente'
     and v_cartel.territorial_feature_id_propuesto = v_feature_id then
    raise exception 'Ya existe una solicitud pendiente para ese feature territorial';
  end if;
  if v_cartel.vinculo_estado = 'aprobado'
     and v_cartel.territorial_feature_id = v_feature_id then
    raise exception 'Ese vinculo territorial ya se encuentra aprobado';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_feature_id, 1301));
  if exists (
    select 1
    from public.carteles c
    where c.id <> p_cartel_id
      and c.vinculo_estado in ('aprobado', 'pendiente')
      and coalesce(c.territorial_feature_id, c.territorial_feature_id_propuesto) = v_feature_id
  ) then
    raise exception 'El feature territorial % ya esta activo o pendiente en otro cartel', v_feature_id;
  end if;

  select p.nombre, p.rol
  into v_nombre, v_rol
  from public.perfiles p
  where p.user_id = auth.uid();

  perform set_config('app.flujo_vinculo', 'solicitar', true);
  update public.carteles
  set territorial_feature_id = null,
      territorial_feature_id_propuesto = v_feature_id,
      vinculo_estado = 'pendiente'
  where id = p_cartel_id;

  insert into public.cartel_vinculo_historial (
    cartel_id,
    territorial_feature_id,
    accion,
    fundamento,
    actor_id,
    actor_nombre,
    actor_rol
  ) values (
    p_cartel_id,
    v_feature_id,
    'solicitado',
    btrim(p_fundamento),
    auth.uid(),
    v_nombre,
    v_rol
  );

  return true;
exception
  when unique_violation then
    raise exception 'El feature territorial % ya esta activo o pendiente en otro cartel', v_feature_id;
end;
$$;

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
  v_feature_id text;
  v_nombre text;
  v_rol public.app_rol;
begin
  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or not public.tiene_rol(array['administrador']::public.app_rol[]) then
    raise exception 'Solo un administrador autenticado puede resolver vinculos';
  end if;
  if nullif(btrim(coalesce(p_cartel_id, '')), '') is null then
    raise exception 'El cartel es obligatorio';
  end if;
  if p_aprobar is null then
    raise exception 'Debe indicar si el vinculo se aprueba o se rechaza';
  end if;
  if char_length(btrim(coalesce(p_fundamento, ''))) < 5 then
    raise exception 'El fundamento debe tener al menos 5 caracteres';
  end if;

  select *
  into v_cartel
  from public.carteles c
  where c.id = p_cartel_id
    and c.vinculo_estado = 'pendiente'
  for update;
  if not found then
    raise exception 'Vinculo pendiente inexistente';
  end if;

  v_feature_id := nullif(btrim(v_cartel.territorial_feature_id_propuesto), '');
  if v_feature_id is null then
    raise exception 'La solicitud pendiente no contiene un feature territorial';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_feature_id, 1301));
  if p_aprobar and exists (
    select 1
    from public.carteles c
    where c.id <> p_cartel_id
      and c.vinculo_estado in ('aprobado', 'pendiente')
      and coalesce(c.territorial_feature_id, c.territorial_feature_id_propuesto) = v_feature_id
  ) then
    raise exception 'El feature territorial % ya esta activo o pendiente en otro cartel', v_feature_id;
  end if;

  select p.nombre, p.rol
  into v_nombre, v_rol
  from public.perfiles p
  where p.user_id = auth.uid();

  perform set_config('app.flujo_vinculo', 'resolver', true);
  if p_aprobar then
    update public.carteles
    set territorial_feature_id = v_feature_id,
        territorial_feature_id_propuesto = null,
        vinculo_estado = 'aprobado'
    where id = p_cartel_id;
  else
    update public.carteles
    set territorial_feature_id = null,
        territorial_feature_id_propuesto = v_feature_id,
        vinculo_estado = 'rechazado'
    where id = p_cartel_id;
  end if;

  insert into public.cartel_vinculo_historial (
    cartel_id,
    territorial_feature_id,
    accion,
    fundamento,
    actor_id,
    actor_nombre,
    actor_rol
  ) values (
    p_cartel_id,
    v_feature_id,
    case when p_aprobar then 'aprobado' else 'rechazado' end,
    btrim(p_fundamento),
    auth.uid(),
    v_nombre,
    v_rol
  );

  return true;
exception
  when unique_violation then
    raise exception 'El feature territorial % ya esta activo o pendiente en otro cartel', v_feature_id;
end;
$$;

-- Alta atomica desde la ficha territorial. Si la propuesta no puede
-- registrarse, el INSERT completo se revierte y no queda un cartel a medias.
create or replace function public.registrar_cartel_y_solicitar_vinculo(
  p_territorial_feature_id text,
  p_fundamento text,
  p_latitud double precision default null,
  p_longitud double precision default null,
  p_empresa text default null,
  p_cuit text default null,
  p_domicilio text default null,
  p_numero text default null
)
returns table (
  record_id text,
  already_existed boolean,
  link_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_feature_id text;
  v_record_id text;
  v_inserted_id text;
  v_cartel public.carteles%rowtype;
begin
  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or not public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[]) then
    raise exception 'No autorizado para registrar carteles';
  end if;

  v_feature_id := nullif(btrim(coalesce(p_territorial_feature_id, '')), '');
  if v_feature_id is null then
    raise exception 'El feature territorial es obligatorio';
  end if;
  if char_length(btrim(coalesce(p_fundamento, ''))) < 5 then
    raise exception 'El fundamento debe tener al menos 5 caracteres';
  end if;

  v_record_id := 'reg-' || v_feature_id;
  insert into public.carteles (
    id,
    empresa,
    cuit,
    domicilio,
    numero,
    latitud,
    longitud,
    estado,
    status
  ) values (
    v_record_id,
    coalesce(p_empresa, ''),
    coalesce(p_cuit, ''),
    coalesce(p_domicilio, ''),
    coalesce(p_numero, ''),
    p_latitud,
    p_longitud,
    'Relevado',
    'relevado'
  )
  on conflict (id) do nothing
  returning id into v_inserted_id;

  select *
  into v_cartel
  from public.carteles c
  where c.id = v_record_id
  for update;
  if not found then
    raise exception 'No se pudo crear ni recuperar el registro administrativo';
  end if;

  if nullif(btrim(coalesce(
       v_cartel.territorial_feature_id,
       v_cartel.territorial_feature_id_propuesto,
       ''
     )), '') is not null
     and coalesce(
       v_cartel.territorial_feature_id,
       v_cartel.territorial_feature_id_propuesto
     ) is distinct from v_feature_id then
    raise exception 'El identificador del registro pertenece a otro feature territorial';
  end if;

  if v_cartel.vinculo_estado = 'aprobado'
     and v_cartel.territorial_feature_id = v_feature_id then
    return query
      select v_record_id, (v_inserted_id is null), 'aprobado'::text;
    return;
  end if;
  if v_cartel.vinculo_estado = 'pendiente'
     and v_cartel.territorial_feature_id_propuesto = v_feature_id then
    return query
      select v_record_id, (v_inserted_id is null), 'pendiente'::text;
    return;
  end if;

  perform public.solicitar_vinculo_cartel(
    v_record_id,
    v_feature_id,
    p_fundamento
  );

  return query
    select v_record_id, (v_inserted_id is null), 'pendiente'::text;
end;
$$;

revoke all on function public.registrar_cartel_y_solicitar_vinculo(
  text, text, double precision, double precision, text, text, text, text
) from public;
grant execute on function public.registrar_cartel_y_solicitar_vinculo(
  text, text, double precision, double precision, text, text, text, text
) to authenticated;

revoke all on function public.solicitar_vinculo_cartel(text, text, text) from public;
revoke all on function public.resolver_vinculo_cartel(text, boolean, text) from public;
grant execute on function public.solicitar_vinculo_cartel(text, text, text) to authenticated;
grant execute on function public.resolver_vinculo_cartel(text, boolean, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Altas de actuaciones: estado inicial, autor real y vinculo aprobado
-- ----------------------------------------------------------------------------
create or replace function public.validar_integridad_actuacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado_inicial text;
  v_roles public.app_rol[];
begin
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' then
    raise exception 'Una actuacion administrativa requiere un usuario autenticado';
  end if;

  if tg_table_name = 'inspecciones' then
    v_estado_inicial := 'nuevo_relevamiento';
    v_roles := array['administrador','coordinador','inspector']::public.app_rol[];
  elsif tg_table_name = 'expedientes' then
    v_estado_inicial := 'abierto';
    v_roles := array['administrador','coordinador']::public.app_rol[];
  else
    raise exception 'Tabla de actuacion no soportada';
  end if;

  if not public.tiene_rol(v_roles) then
    raise exception 'No autorizado para modificar esta actuacion';
  end if;

  if tg_op = 'INSERT' then
    if new.estado is distinct from v_estado_inicial then
      raise exception 'La actuacion debe crearse en el estado inicial %', v_estado_inicial;
    end if;
    if new.created_by is not null and new.created_by is distinct from auth.uid() then
      raise exception 'El autor de la actuacion debe coincidir con la sesion';
    end if;
    if not public.cartel_tiene_vinculo_aprobado(new.cartel_id) then
      raise exception 'El cartel requiere un vinculo territorial aprobado';
    end if;
    new.created_by := auth.uid();
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'El identificador de una actuacion es inmutable';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'El autor de una actuacion es inmutable';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'La fecha de alta de una actuacion es inmutable';
  end if;
  if new.cartel_id is distinct from old.cartel_id then
    raise exception 'El cartel de una actuacion es inmutable';
  end if;
  if new.updated_at is distinct from old.updated_at then
    raise exception 'La fecha de actualizacion es derivada por la base';
  end if;

  if tg_table_name = 'expedientes' then
    if (to_jsonb(new)->'numero') is distinct from (to_jsonb(old)->'numero') then
      raise exception 'El numero de expediente es inmutable';
    end if;
    if (to_jsonb(new)->'cerrado_en') is distinct from (to_jsonb(old)->'cerrado_en') then
      raise exception 'La fecha de cierre es derivada por la base';
    end if;
  end if;

  -- Este trigger se ejecuta alfabeticamente antes de los triggers `*_touch`.
  -- Por eso rechaza valores derivados enviados por el cliente y luego permite
  -- que la base calcule updated_at/cerrado_en. `superficie_m2` ya es una
  -- columna GENERATED ALWAYS y PostgreSQL la recalcula despues de los BEFORE.
  if not public.cartel_tiene_vinculo_aprobado(old.cartel_id) then
    raise exception 'El cartel requiere un vinculo territorial aprobado';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_inspecciones_integridad_actuacion on public.inspecciones;
create trigger trg_inspecciones_integridad_actuacion
  before insert or update on public.inspecciones
  for each row execute function public.validar_integridad_actuacion();

drop trigger if exists trg_expedientes_integridad_actuacion on public.expedientes;
create trigger trg_expedientes_integridad_actuacion
  before insert or update on public.expedientes
  for each row execute function public.validar_integridad_actuacion();

-- Solo una RPC administrativa puede aplicar una transicion. El chequeo vuelve
-- a validar el vinculo en el instante exacto del UPDATE.
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
  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or not public.tiene_rol(array['administrador']::public.app_rol[])
     or coalesce(current_setting('app.aprobacion_estado', true), '') <> 'inspeccion' then
    raise exception 'El estado de una inspeccion solo puede cambiarse mediante aprobacion administrativa';
  end if;
  if not public.cartel_tiene_vinculo_aprobado(new.cartel_id) then
    raise exception 'El cartel requiere un vinculo territorial aprobado';
  end if;
  if not exists (
    select 1
    from public.inspeccion_transiciones t
    where t.estado_anterior = old.estado
      and t.estado_nuevo = new.estado
  ) then
    raise exception 'Transicion de inspeccion no permitida: % -> %', old.estado, new.estado;
  end if;
  return new;
end;
$$;

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
  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or not public.tiene_rol(array['administrador']::public.app_rol[])
     or coalesce(current_setting('app.aprobacion_estado', true), '') <> 'expediente' then
    raise exception 'El estado de un expediente solo puede cambiarse mediante aprobacion administrativa';
  end if;
  if not public.cartel_tiene_vinculo_aprobado(new.cartel_id) then
    raise exception 'El cartel requiere un vinculo territorial aprobado';
  end if;
  if not exists (
    select 1
    from public.expediente_transiciones t
    where t.estado_anterior = old.estado
      and t.estado_nuevo = new.estado
  ) then
    raise exception 'Transicion de expediente no permitida: % -> %', old.estado, new.estado;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Solicitudes y resoluciones de estado sin NULL ni duplicados silenciosos
-- ----------------------------------------------------------------------------
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
  v_cartel_id text;
  v_estado_nuevo text;
  v_solicitud_id uuid;
  v_pendiente_id uuid;
  v_nombre text;
  v_rol public.app_rol;
begin
  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or not public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[]) then
    raise exception 'No autorizado';
  end if;
  if p_inspeccion_id is null then
    raise exception 'La inspeccion es obligatoria';
  end if;
  v_estado_nuevo := nullif(btrim(coalesce(p_estado_nuevo, '')), '');
  if v_estado_nuevo is null then
    raise exception 'El nuevo estado es obligatorio';
  end if;
  if char_length(btrim(coalesce(p_fundamento, ''))) < 5 then
    raise exception 'El fundamento debe tener al menos 5 caracteres';
  end if;

  select i.estado, i.cartel_id
  into v_estado_actual, v_cartel_id
  from public.inspecciones i
  where i.id = p_inspeccion_id
  for update;
  if not found then
    raise exception 'Inspeccion inexistente';
  end if;
  if not public.cartel_tiene_vinculo_aprobado(v_cartel_id) then
    raise exception 'El cartel requiere un vinculo territorial aprobado';
  end if;
  if v_estado_nuevo = v_estado_actual then
    raise exception 'La inspeccion ya se encuentra en el estado solicitado';
  end if;
  if not exists (
    select 1
    from public.inspeccion_transiciones t
    where t.estado_anterior = v_estado_actual
      and t.estado_nuevo = v_estado_nuevo
  ) then
    raise exception 'Transicion de inspeccion no permitida';
  end if;

  select p.nombre, p.rol
  into v_nombre, v_rol
  from public.perfiles p
  where p.user_id = auth.uid();

  select s.id
  into v_pendiente_id
  from public.cambio_estado_solicitudes s
  where s.inspeccion_id = p_inspeccion_id
    and s.estado = 'pendiente'
  for update;

  if public.tiene_rol(array['administrador']::public.app_rol[]) then
    if v_pendiente_id is not null then
      perform set_config('app.flujo_solicitud_estado', 'cancelar', true);
      perform set_config('app.flujo_solicitud_estado_id', v_pendiente_id::text, true);
      update public.cambio_estado_solicitudes
      set estado = 'cancelada',
          resuelto_por = auth.uid(),
          resolutor_nombre = v_nombre,
          resolutor_rol = v_rol,
          nota_resolucion = 'Cancelada por accion directa del administrador: ' || btrim(p_fundamento),
          resolved_at = now()
      where id = v_pendiente_id;
    end if;

    perform set_config('app.aprobacion_estado', 'inspeccion', true);
    update public.inspecciones
    set estado = v_estado_nuevo
    where id = p_inspeccion_id;

    insert into public.cambio_estado_solicitudes (
      entidad,
      inspeccion_id,
      estado_anterior,
      estado_solicitado,
      fundamento,
      estado,
      solicitado_por,
      solicitante_nombre,
      solicitante_rol,
      resuelto_por,
      resolutor_nombre,
      resolutor_rol,
      nota_resolucion,
      resolved_at
    ) values (
      'inspeccion',
      p_inspeccion_id,
      v_estado_actual,
      v_estado_nuevo,
      btrim(p_fundamento),
      'aprobada',
      auth.uid(),
      v_nombre,
      v_rol,
      auth.uid(),
      v_nombre,
      v_rol,
      'Aprobacion directa del administrador',
      now()
    )
    returning id into v_solicitud_id;

    return query select 'aplicado'::text, v_solicitud_id;
    return;
  end if;

  if v_pendiente_id is not null then
    raise exception 'Ya existe una solicitud pendiente para esta inspeccion';
  end if;

  begin
    insert into public.cambio_estado_solicitudes (
      entidad,
      inspeccion_id,
      estado_anterior,
      estado_solicitado,
      fundamento,
      solicitado_por,
      solicitante_nombre,
      solicitante_rol
    ) values (
      'inspeccion',
      p_inspeccion_id,
      v_estado_actual,
      v_estado_nuevo,
      btrim(p_fundamento),
      auth.uid(),
      v_nombre,
      v_rol
    )
    returning id into v_solicitud_id;
  exception
    when unique_violation then
      raise exception 'Ya existe una solicitud pendiente para esta inspeccion';
  end;

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
  v_cartel_id text;
  v_estado_nuevo text;
  v_solicitud_id uuid;
  v_pendiente_id uuid;
  v_nombre text;
  v_rol public.app_rol;
begin
  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or not public.tiene_rol(array['administrador','coordinador']::public.app_rol[]) then
    raise exception 'No autorizado';
  end if;
  if p_expediente_id is null then
    raise exception 'El expediente es obligatorio';
  end if;
  v_estado_nuevo := nullif(btrim(coalesce(p_estado_nuevo, '')), '');
  if v_estado_nuevo is null then
    raise exception 'El nuevo estado es obligatorio';
  end if;
  if char_length(btrim(coalesce(p_fundamento, ''))) < 5 then
    raise exception 'El fundamento debe tener al menos 5 caracteres';
  end if;

  select e.estado, e.cartel_id
  into v_estado_actual, v_cartel_id
  from public.expedientes e
  where e.id = p_expediente_id
  for update;
  if not found then
    raise exception 'Expediente inexistente';
  end if;
  if not public.cartel_tiene_vinculo_aprobado(v_cartel_id) then
    raise exception 'El cartel requiere un vinculo territorial aprobado';
  end if;
  if v_estado_nuevo = v_estado_actual then
    raise exception 'El expediente ya se encuentra en el estado solicitado';
  end if;
  if not exists (
    select 1
    from public.expediente_transiciones t
    where t.estado_anterior = v_estado_actual
      and t.estado_nuevo = v_estado_nuevo
  ) then
    raise exception 'Transicion de expediente no permitida';
  end if;

  select p.nombre, p.rol
  into v_nombre, v_rol
  from public.perfiles p
  where p.user_id = auth.uid();

  select s.id
  into v_pendiente_id
  from public.cambio_estado_solicitudes s
  where s.expediente_id = p_expediente_id
    and s.estado = 'pendiente'
  for update;

  if public.tiene_rol(array['administrador']::public.app_rol[]) then
    if v_pendiente_id is not null then
      perform set_config('app.flujo_solicitud_estado', 'cancelar', true);
      perform set_config('app.flujo_solicitud_estado_id', v_pendiente_id::text, true);
      update public.cambio_estado_solicitudes
      set estado = 'cancelada',
          resuelto_por = auth.uid(),
          resolutor_nombre = v_nombre,
          resolutor_rol = v_rol,
          nota_resolucion = 'Cancelada por accion directa del administrador: ' || btrim(p_fundamento),
          resolved_at = now()
      where id = v_pendiente_id;
    end if;

    perform set_config('app.aprobacion_estado', 'expediente', true);
    update public.expedientes
    set estado = v_estado_nuevo
    where id = p_expediente_id;

    insert into public.cambio_estado_solicitudes (
      entidad,
      expediente_id,
      estado_anterior,
      estado_solicitado,
      fundamento,
      estado,
      solicitado_por,
      solicitante_nombre,
      solicitante_rol,
      resuelto_por,
      resolutor_nombre,
      resolutor_rol,
      nota_resolucion,
      resolved_at
    ) values (
      'expediente',
      p_expediente_id,
      v_estado_actual,
      v_estado_nuevo,
      btrim(p_fundamento),
      'aprobada',
      auth.uid(),
      v_nombre,
      v_rol,
      auth.uid(),
      v_nombre,
      v_rol,
      'Aprobacion directa del administrador',
      now()
    )
    returning id into v_solicitud_id;

    return query select 'aplicado'::text, v_solicitud_id;
    return;
  end if;

  if v_pendiente_id is not null then
    raise exception 'Ya existe una solicitud pendiente para este expediente';
  end if;

  begin
    insert into public.cambio_estado_solicitudes (
      entidad,
      expediente_id,
      estado_anterior,
      estado_solicitado,
      fundamento,
      solicitado_por,
      solicitante_nombre,
      solicitante_rol
    ) values (
      'expediente',
      p_expediente_id,
      v_estado_actual,
      v_estado_nuevo,
      btrim(p_fundamento),
      auth.uid(),
      v_nombre,
      v_rol
    )
    returning id into v_solicitud_id;
  exception
    when unique_violation then
      raise exception 'Ya existe una solicitud pendiente para este expediente';
  end;

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
  v_cartel_id text;
  v_nombre text;
  v_rol public.app_rol;
begin
  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or not public.tiene_rol(array['administrador']::public.app_rol[]) then
    raise exception 'Solo un administrador autenticado puede resolver solicitudes';
  end if;
  if p_solicitud_id is null then
    raise exception 'La solicitud es obligatoria';
  end if;
  if p_aprobar is null then
    raise exception 'Debe indicar si la solicitud se aprueba o se rechaza';
  end if;
  if char_length(btrim(coalesce(p_nota, ''))) < 5 then
    raise exception 'La resolucion debe tener al menos 5 caracteres';
  end if;

  -- Primera lectura para conocer la actuacion. El lock definitivo se toma en el
  -- mismo orden que las RPC de solicitud: actuacion y luego solicitud.
  select *
  into v_solicitud
  from public.cambio_estado_solicitudes s
  where s.id = p_solicitud_id
    and s.estado = 'pendiente';
  if not found then
    raise exception 'Solicitud pendiente inexistente';
  end if;

  if v_solicitud.entidad = 'inspeccion' then
    select i.estado, i.cartel_id
    into v_estado_actual, v_cartel_id
    from public.inspecciones i
    where i.id = v_solicitud.inspeccion_id
    for update;
    if not found then
      raise exception 'Inspeccion inexistente';
    end if;
  elsif v_solicitud.entidad = 'expediente' then
    select e.estado, e.cartel_id
    into v_estado_actual, v_cartel_id
    from public.expedientes e
    where e.id = v_solicitud.expediente_id
    for update;
    if not found then
      raise exception 'Expediente inexistente';
    end if;
  else
    raise exception 'Tipo de solicitud invalido';
  end if;

  select *
  into v_solicitud
  from public.cambio_estado_solicitudes s
  where s.id = p_solicitud_id
    and s.estado = 'pendiente'
  for update;
  if not found then
    raise exception 'La solicitud ya fue resuelta o cancelada';
  end if;

  select p.nombre, p.rol
  into v_nombre, v_rol
  from public.perfiles p
  where p.user_id = auth.uid();

  if p_aprobar then
    if not public.cartel_tiene_vinculo_aprobado(v_cartel_id) then
      raise exception 'El cartel requiere un vinculo territorial aprobado';
    end if;
    if v_estado_actual is distinct from v_solicitud.estado_anterior then
      raise exception 'La actuacion cambio desde que se creo la solicitud';
    end if;

    if v_solicitud.entidad = 'inspeccion' then
      if not exists (
        select 1
        from public.inspeccion_transiciones t
        where t.estado_anterior = v_estado_actual
          and t.estado_nuevo = v_solicitud.estado_solicitado
      ) then
        raise exception 'La transicion solicitada ya no esta permitida';
      end if;
      perform set_config('app.aprobacion_estado', 'inspeccion', true);
      update public.inspecciones
      set estado = v_solicitud.estado_solicitado
      where id = v_solicitud.inspeccion_id;
    else
      if not exists (
        select 1
        from public.expediente_transiciones t
        where t.estado_anterior = v_estado_actual
          and t.estado_nuevo = v_solicitud.estado_solicitado
      ) then
        raise exception 'La transicion solicitada ya no esta permitida';
      end if;
      perform set_config('app.aprobacion_estado', 'expediente', true);
      update public.expedientes
      set estado = v_solicitud.estado_solicitado
      where id = v_solicitud.expediente_id;
    end if;
  end if;

  perform set_config('app.flujo_solicitud_estado', 'resolver', true);
  perform set_config('app.flujo_solicitud_estado_id', p_solicitud_id::text, true);
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

-- La cola global contiene fundamentos administrativos: solo el administrador
-- la enumera completa. Cada solicitante operativo conserva acceso a lo propio.
drop policy if exists cambio_estado_solicitudes_select on public.cambio_estado_solicitudes;
create policy cambio_estado_solicitudes_select on public.cambio_estado_solicitudes
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector','consulta']::public.app_rol[]
    )
    and (
      public.tiene_rol(array['administrador']::public.app_rol[])
      or solicitado_por = auth.uid()
    )
  );

-- Toda lectura del registro administrativo exige una fila de perfil con un rol
-- reconocido. `consulta` conserva lectura, pero nunca obtiene escritura.
drop policy if exists carteles_authenticated_read on public.carteles;
create policy carteles_authenticated_read on public.carteles
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector','consulta']::public.app_rol[]
    )
  );

drop policy if exists inspecciones_select on public.inspecciones;
create policy inspecciones_select on public.inspecciones
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector','consulta']::public.app_rol[]
    )
  );

drop policy if exists inspeccion_fotos_select on public.inspeccion_fotos;
create policy inspeccion_fotos_select on public.inspeccion_fotos
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector','consulta']::public.app_rol[]
    )
  );

drop policy if exists inspeccion_historial_select on public.inspeccion_historial;
create policy inspeccion_historial_select on public.inspeccion_historial
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector','consulta']::public.app_rol[]
    )
  );

drop policy if exists expediente_estados_read on public.expediente_estados;
create policy expediente_estados_read on public.expediente_estados
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector','consulta']::public.app_rol[]
    )
  );

drop policy if exists expedientes_select on public.expedientes;
create policy expedientes_select on public.expedientes
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector','consulta']::public.app_rol[]
    )
  );

drop policy if exists expediente_documentos_select on public.expediente_documentos;
create policy expediente_documentos_select on public.expediente_documentos
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector','consulta']::public.app_rol[]
    )
  );

drop policy if exists expediente_historial_select on public.expediente_historial;
create policy expediente_historial_select on public.expediente_historial
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector','consulta']::public.app_rol[]
    )
  );

drop policy if exists inspeccion_transiciones_select on public.inspeccion_transiciones;
create policy inspeccion_transiciones_select on public.inspeccion_transiciones
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector','consulta']::public.app_rol[]
    )
  );

drop policy if exists expediente_transiciones_select on public.expediente_transiciones;
create policy expediente_transiciones_select on public.expediente_transiciones
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector','consulta']::public.app_rol[]
    )
  );

drop policy if exists cartel_vinculo_historial_select on public.cartel_vinculo_historial;
create policy cartel_vinculo_historial_select on public.cartel_vinculo_historial
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector','consulta']::public.app_rol[]
    )
  );

-- ----------------------------------------------------------------------------
-- 5. La cadena administrativa no admite borrado ni reescritura
-- ----------------------------------------------------------------------------
create or replace function public.proteger_registro_legal_no_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Un registro de la cadena administrativa no puede eliminarse fisicamente';
end;
$$;

create or replace function public.proteger_historial_legal_inmutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Un historial administrativo es inmutable';
end;
$$;

-- Las solicitudes se actualizan porque una resolucion debe cerrar la fila
-- pendiente. Solo las RPC administrativas pueden hacerlo: ademas del marcador
-- transaccional, el trigger exige una persona administradora real, el ID exacto
-- que la RPC bloqueo y que todos los datos originales permanezcan inmutables.
create or replace function public.validar_mutacion_solicitud_estado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_modo text;
  v_nombre text;
  v_rol public.app_rol;
begin
  if tg_op = 'DELETE' then
    raise exception 'Una solicitud administrativa no puede eliminarse fisicamente';
  end if;

  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or not public.tiene_rol(array['administrador']::public.app_rol[]) then
    raise exception 'Solo una RPC administrativa autenticada puede resolver solicitudes';
  end if;

  v_modo := coalesce(current_setting('app.flujo_solicitud_estado', true), '');
  if v_modo not in ('cancelar', 'resolver')
     or coalesce(current_setting('app.flujo_solicitud_estado_id', true), '') <> old.id::text then
    raise exception 'La solicitud solo puede actualizarse mediante el flujo administrativo';
  end if;

  if new.id is distinct from old.id
     or new.entidad is distinct from old.entidad
     or new.inspeccion_id is distinct from old.inspeccion_id
     or new.expediente_id is distinct from old.expediente_id
     or new.estado_anterior is distinct from old.estado_anterior
     or new.estado_solicitado is distinct from old.estado_solicitado
     or new.fundamento is distinct from old.fundamento
     or new.solicitado_por is distinct from old.solicitado_por
     or new.solicitante_nombre is distinct from old.solicitante_nombre
     or new.solicitante_rol is distinct from old.solicitante_rol
     or new.created_at is distinct from old.created_at then
    raise exception 'Los datos originales de una solicitud son inmutables';
  end if;

  if old.estado <> 'pendiente' then
    raise exception 'Solo una solicitud pendiente puede resolverse';
  end if;
  if (v_modo = 'cancelar' and new.estado <> 'cancelada')
     or (v_modo = 'resolver' and new.estado not in ('aprobada', 'rechazada')) then
    raise exception 'La resolucion solicitada no coincide con el flujo autorizado';
  end if;

  select p.nombre, p.rol
  into v_nombre, v_rol
  from public.perfiles p
  where p.user_id = auth.uid();
  if not found or v_rol <> 'administrador'::public.app_rol then
    raise exception 'El resolutor no tiene un perfil administrador valido';
  end if;

  if new.resuelto_por is distinct from auth.uid()
     or new.resolutor_nombre is distinct from v_nombre
     or new.resolutor_rol is distinct from v_rol then
    raise exception 'La identidad del resolutor no coincide con la sesion';
  end if;
  if char_length(btrim(coalesce(new.nota_resolucion, ''))) < 5 then
    raise exception 'La resolucion debe tener al menos 5 caracteres';
  end if;
  if new.resolved_at is distinct from now() then
    raise exception 'La fecha de resolucion debe ser generada por la base';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_inspecciones_no_delete on public.inspecciones;
create trigger trg_inspecciones_no_delete
  before delete on public.inspecciones
  for each row execute function public.proteger_registro_legal_no_delete();

drop trigger if exists trg_expedientes_no_delete on public.expedientes;
create trigger trg_expedientes_no_delete
  before delete on public.expedientes
  for each row execute function public.proteger_registro_legal_no_delete();

drop trigger if exists trg_solicitudes_estado_no_delete on public.cambio_estado_solicitudes;
drop trigger if exists trg_solicitudes_estado_integridad on public.cambio_estado_solicitudes;
create trigger trg_solicitudes_estado_integridad
  before update or delete on public.cambio_estado_solicitudes
  for each row execute function public.validar_mutacion_solicitud_estado();

drop trigger if exists trg_inspeccion_historial_no_delete on public.inspeccion_historial;
drop trigger if exists trg_inspeccion_historial_inmutable on public.inspeccion_historial;
create trigger trg_inspeccion_historial_inmutable
  before update or delete on public.inspeccion_historial
  for each row execute function public.proteger_historial_legal_inmutable();

drop trigger if exists trg_expediente_historial_no_delete on public.expediente_historial;
drop trigger if exists trg_expediente_historial_inmutable on public.expediente_historial;
create trigger trg_expediente_historial_inmutable
  before update or delete on public.expediente_historial
  for each row execute function public.proteger_historial_legal_inmutable();

drop trigger if exists trg_cartel_vinculo_historial_no_delete on public.cartel_vinculo_historial;
drop trigger if exists trg_cartel_vinculo_historial_inmutable on public.cartel_vinculo_historial;
create trigger trg_cartel_vinculo_historial_inmutable
  before update or delete on public.cartel_vinculo_historial
  for each row execute function public.proteger_historial_legal_inmutable();

revoke delete on public.inspecciones from anon, authenticated, service_role;
revoke delete on public.expedientes from anon, authenticated, service_role;
revoke insert, update, delete on public.cambio_estado_solicitudes
  from anon, authenticated, service_role;
revoke insert, update, delete on public.inspeccion_historial
  from anon, authenticated, service_role;
revoke insert, update, delete on public.expediente_historial
  from anon, authenticated, service_role;
revoke insert, update, delete on public.cartel_vinculo_historial
  from anon, authenticated, service_role;

-- TRUNCATE no ejecuta triggers por fila ni se somete a RLS.
revoke truncate on table
  public.carteles,
  public.inspecciones,
  public.inspeccion_fotos,
  public.inspeccion_historial,
  public.expedientes,
  public.expediente_documentos,
  public.expediente_historial,
  public.inspeccion_transiciones,
  public.expediente_transiciones,
  public.cambio_estado_solicitudes,
  public.cartel_vinculo_historial,
  public.auditoria_eventos
from anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Evidencia con hash obligatorio para nuevas filas e insert-only
-- ----------------------------------------------------------------------------
alter table public.inspeccion_fotos
  add column if not exists sha256 text,
  add column if not exists mime_type text,
  add column if not exists byte_size bigint,
  add column if not exists created_by uuid references auth.users(id);

alter table public.expediente_documentos
  add column if not exists sha256 text,
  add column if not exists mime_type text,
  add column if not exists byte_size bigint;

create unique index if not exists inspeccion_fotos_storage_path_uidx
  on public.inspeccion_fotos(storage_path);
create unique index if not exists expediente_documentos_storage_path_uidx
  on public.expediente_documentos(storage_path);

alter table public.inspeccion_fotos
  drop constraint if exists inspeccion_fotos_sha256_check,
  drop constraint if exists inspeccion_fotos_tamano_check,
  drop constraint if exists inspeccion_fotos_mime_check;

alter table public.inspeccion_fotos
  add constraint inspeccion_fotos_sha256_check
    check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  add constraint inspeccion_fotos_tamano_check
    check (byte_size is null or (byte_size > 0 and byte_size <= 10485760)),
  add constraint inspeccion_fotos_mime_check
    check (mime_type is null or mime_type ~ '^image/[a-z0-9.+-]+$');

alter table public.expediente_documentos
  drop constraint if exists expediente_documentos_sha256_check,
  drop constraint if exists expediente_documentos_tamano_check,
  drop constraint if exists expediente_documentos_mime_check;

alter table public.expediente_documentos
  add constraint expediente_documentos_sha256_check
    check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  add constraint expediente_documentos_tamano_check
    check (byte_size is null or (byte_size > 0 and byte_size <= 10485760)),
  add constraint expediente_documentos_mime_check
    check (
      mime_type is null
      or mime_type = 'application/pdf'
      or mime_type ~ '^image/[a-z0-9.+-]+$'
    );

create or replace function public.validar_alta_evidencia()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cartel_id text;
  v_roles public.app_rol[];
  v_actor_id uuid;
  v_actor_rol public.app_rol;
  v_bucket_id text;
  v_entity_id text;
  v_storage_object jsonb;
  v_storage_size text;
  v_storage_mime text;
  v_storage_sha256 text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     or coalesce(current_setting('app.finalizacion_evidencia', true), '') <> 'server' then
    raise exception 'La evidencia solo puede finalizarse mediante el servicio verificador';
  end if;
  v_actor_id := new.created_by;
  if v_actor_id is null then
    raise exception 'La evidencia requiere un autor autenticado verificado';
  end if;
  select p.rol
  into v_actor_rol
  from public.perfiles p
  where p.user_id = v_actor_id;
  if not found then
    raise exception 'El autor no tiene un perfil municipal valido';
  end if;

  if tg_table_name = 'inspeccion_fotos' then
    v_roles := array['administrador','coordinador','inspector']::public.app_rol[];
    v_bucket_id := 'inspeccion-fotos';
    v_entity_id := to_jsonb(new)->>'inspeccion_id';
    select i.cartel_id
    into v_cartel_id
    from public.inspecciones i
    where i.id = (to_jsonb(new)->>'inspeccion_id')::uuid;
    if not found then
      raise exception 'Inspeccion inexistente';
    end if;
  elsif tg_table_name = 'expediente_documentos' then
    v_roles := array['administrador','coordinador']::public.app_rol[];
    v_bucket_id := 'expediente-docs';
    v_entity_id := to_jsonb(new)->>'expediente_id';
    select e.cartel_id
    into v_cartel_id
    from public.expedientes e
    where e.id = (to_jsonb(new)->>'expediente_id')::uuid;
    if not found then
      raise exception 'Expediente inexistente';
    end if;
  else
    raise exception 'Tabla de evidencia no soportada';
  end if;

  if not (v_actor_rol = any(v_roles)) then
    raise exception 'No autorizado para incorporar evidencia';
  end if;
  if not public.cartel_tiene_vinculo_aprobado(v_cartel_id) then
    raise exception 'El cartel requiere un vinculo territorial aprobado';
  end if;
  if nullif(btrim(coalesce(new.storage_path, '')), '') is null then
    raise exception 'La ruta de almacenamiento es obligatoria';
  end if;
  if new.storage_path not like v_entity_id || '/%' then
    raise exception 'La ruta no pertenece a la actuacion indicada';
  end if;

  new.sha256 := lower(nullif(btrim(coalesce(new.sha256, '')), ''));
  if new.sha256 is null or new.sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Debe informar un SHA-256 valido de 64 caracteres hexadecimales';
  end if;

  new.mime_type := lower(nullif(btrim(coalesce(new.mime_type, '')), ''));
  if new.mime_type is null then
    raise exception 'El tipo MIME es obligatorio';
  end if;
  if tg_table_name = 'inspeccion_fotos'
     and new.mime_type !~ '^image/[a-z0-9.+-]+$' then
    raise exception 'Las fotos de inspeccion deben tener un MIME de imagen';
  end if;
  if tg_table_name = 'expediente_documentos'
     and new.mime_type <> 'application/pdf'
     and new.mime_type !~ '^image/[a-z0-9.+-]+$' then
    raise exception 'El documento debe ser PDF o imagen';
  end if;

  if new.byte_size is null
     or new.byte_size <= 0
     or new.byte_size > 10485760 then
    raise exception 'El tamano debe estar entre 1 byte y 10 MB';
  end if;

  select to_jsonb(o)
  into v_storage_object
  from storage.objects o
  where o.bucket_id = v_bucket_id
    and o.name = new.storage_path;
  if not found then
    raise exception 'El objeto de evidencia no existe en Storage';
  end if;
  if coalesce(v_storage_object->>'owner_id', '') <> v_actor_id::text then
    raise exception 'El objeto de evidencia no pertenece al autor verificado';
  end if;

  v_storage_size := v_storage_object->'metadata'->>'size';
  v_storage_mime := lower(coalesce(v_storage_object->'metadata'->>'mimetype', ''));
  v_storage_sha256 := lower(coalesce(
    v_storage_object->'user_metadata'->>'sha256',
    ''
  ));
  if v_storage_size !~ '^[0-9]+$'
     or v_storage_size::bigint is distinct from new.byte_size then
    raise exception 'El tamano declarado no coincide con Storage';
  end if;
  if v_storage_mime is distinct from new.mime_type then
    raise exception 'El MIME declarado no coincide con Storage';
  end if;
  if v_storage_sha256 is distinct from new.sha256 then
    raise exception 'El SHA-256 declarado no coincide con el metadato inmutable de carga';
  end if;

  new.created_by := v_actor_id;

  return new;
end;
$$;

create or replace function public.proteger_evidencia_inmutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'La evidencia es inmutable; una correccion debe crear una nueva version';
end;
$$;

drop trigger if exists trg_inspeccion_fotos_validar_alta on public.inspeccion_fotos;
create trigger trg_inspeccion_fotos_validar_alta
  before insert on public.inspeccion_fotos
  for each row execute function public.validar_alta_evidencia();

drop trigger if exists trg_expediente_documentos_validar_alta on public.expediente_documentos;
create trigger trg_expediente_documentos_validar_alta
  before insert on public.expediente_documentos
  for each row execute function public.validar_alta_evidencia();

-- El servidor descarga el objeto, calcula la huella sobre los bytes reales y
-- llama esta RPC con service_role. La autoria legal sigue siendo la persona
-- autenticada indicada en p_actor_id; service_role solo finaliza tecnicamente.
create or replace function public.finalizar_evidencia_verificada(
  p_tipo text,
  p_actuacion_id uuid,
  p_storage_path text,
  p_descripcion text,
  p_sha256 text,
  p_byte_size bigint,
  p_mime_type text,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_orden integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'La finalizacion de evidencia requiere el proceso tecnico autorizado';
  end if;
  if p_tipo not in ('inspeccion_foto', 'expediente_documento') then
    raise exception 'Tipo de evidencia invalido';
  end if;
  if p_actuacion_id is null or p_actor_id is null then
    raise exception 'La actuacion y el actor son obligatorios';
  end if;

  if p_tipo = 'inspeccion_foto' then
    perform 1
    from public.inspecciones i
    where i.id = p_actuacion_id
    for update;
    if not found then
      raise exception 'Inspeccion inexistente';
    end if;

    -- La comprobacion idempotente ocurre despues del lock de la actuacion.
    -- Una segunda finalizacion concurrente espera, observa la fila creada por
    -- la primera y devuelve exactamente el mismo ID.
    select f.id
    into v_id
    from public.inspeccion_fotos f
    where f.storage_path = p_storage_path;
    if found then
      if not exists (
        select 1
        from public.inspeccion_fotos f
        where f.id = v_id
          and f.inspeccion_id = p_actuacion_id
          and f.created_by = p_actor_id
          and f.sha256 = lower(btrim(p_sha256))
          and f.byte_size = p_byte_size
          and f.mime_type = lower(btrim(p_mime_type))
      ) then
        raise exception 'La ruta ya pertenece a otra evidencia';
      end if;
      return v_id;
    end if;

    if (
      select count(*)
      from public.inspeccion_fotos f
      where f.inspeccion_id = p_actuacion_id
    ) >= 6 then
      raise exception 'La inspeccion ya alcanzo el maximo de 6 fotos';
    end if;
    select coalesce(max(f.orden), -1) + 1
    into v_orden
    from public.inspeccion_fotos f
    where f.inspeccion_id = p_actuacion_id;

    perform set_config('app.finalizacion_evidencia', 'server', true);
    insert into public.inspeccion_fotos (
      inspeccion_id,
      storage_path,
      descripcion,
      orden,
      sha256,
      byte_size,
      mime_type,
      created_by
    ) values (
      p_actuacion_id,
      p_storage_path,
      nullif(btrim(coalesce(p_descripcion, '')), ''),
      v_orden,
      p_sha256,
      p_byte_size,
      p_mime_type,
      p_actor_id
    )
    returning id into v_id;
    return v_id;
  end if;

  perform 1
  from public.expedientes e
  where e.id = p_actuacion_id
  for update;
  if not found then
    raise exception 'Expediente inexistente';
  end if;

  select d.id
  into v_id
  from public.expediente_documentos d
  where d.storage_path = p_storage_path;
  if found then
    if not exists (
      select 1
      from public.expediente_documentos d
      where d.id = v_id
        and d.expediente_id = p_actuacion_id
        and d.created_by = p_actor_id
        and d.sha256 = lower(btrim(p_sha256))
        and d.byte_size = p_byte_size
        and d.mime_type = lower(btrim(p_mime_type))
    ) then
      raise exception 'La ruta ya pertenece a otra evidencia';
    end if;
    return v_id;
  end if;

  perform set_config('app.finalizacion_evidencia', 'server', true);
  insert into public.expediente_documentos (
    expediente_id,
    storage_path,
    descripcion,
    tipo,
    sha256,
    byte_size,
    mime_type,
    created_by
  ) values (
    p_actuacion_id,
    p_storage_path,
    nullif(btrim(coalesce(p_descripcion, '')), ''),
    lower(btrim(p_mime_type)),
    p_sha256,
    p_byte_size,
    p_mime_type,
    p_actor_id
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.finalizar_evidencia_verificada(
  text, uuid, text, text, text, bigint, text, uuid
) from public;
grant execute on function public.finalizar_evidencia_verificada(
  text, uuid, text, text, text, bigint, text, uuid
) to service_role;

drop trigger if exists trg_inspeccion_fotos_inmutable on public.inspeccion_fotos;
create trigger trg_inspeccion_fotos_inmutable
  before update or delete on public.inspeccion_fotos
  for each row execute function public.proteger_evidencia_inmutable();

drop trigger if exists trg_expediente_documentos_inmutable on public.expediente_documentos;
create trigger trg_expediente_documentos_inmutable
  before update or delete on public.expediente_documentos
  for each row execute function public.proteger_evidencia_inmutable();

drop policy if exists inspeccion_fotos_write on public.inspeccion_fotos;
drop policy if exists inspeccion_fotos_update on public.inspeccion_fotos;
drop policy if exists inspeccion_fotos_insert on public.inspeccion_fotos;

drop policy if exists expediente_documentos_write on public.expediente_documentos;
drop policy if exists expediente_documentos_update on public.expediente_documentos;
drop policy if exists expediente_documentos_insert on public.expediente_documentos;

revoke insert, update, delete on public.inspeccion_fotos from anon, authenticated, service_role;
revoke insert, update, delete on public.expediente_documentos from anon, authenticated, service_role;

-- Storage tambien queda sin caminos de UPDATE/DELETE para usuarios de la app.
-- Las cargas deben utilizar nombres nuevos (upsert=false).
drop policy if exists inspeccion_fotos_update on storage.objects;
drop policy if exists inspeccion_fotos_delete on storage.objects;
drop policy if exists expediente_docs_update on storage.objects;
drop policy if exists expediente_docs_delete on storage.objects;
drop policy if exists inspeccion_fotos_read on storage.objects;
create policy inspeccion_fotos_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'inspeccion-fotos'
    and (
      owner_id = auth.uid()::text
      or exists (
        select 1
        from public.inspeccion_fotos f
        where f.storage_path = name
      )
    )
  );

drop policy if exists expediente_docs_read on storage.objects;
create policy expediente_docs_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'expediente-docs'
    and (
      owner_id = auth.uid()::text
      or exists (
        select 1
        from public.expediente_documentos d
        where d.storage_path = name
      )
    )
  );

-- ----------------------------------------------------------------------------
-- 6b. Ledger previo de cargas: cupo, ruta, lease y limpieza idempotente
-- ----------------------------------------------------------------------------
-- El navegador sube directo a Storage con su JWT. Antes debe reservar un ticket
-- que fija bucket, ruta, actor, actuacion, hash, MIME y tamano. Vercel recibe
-- solo el ticket y calcula nuevamente la huella sobre los bytes almacenados.
do $$
begin
  create type public.evidencia_tipo as enum (
    'inspeccion_foto',
    'expediente_documento'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.evidencia_carga_estado as enum (
    'reservada',
    'procesando',
    'finalizada',
    'limpieza',
    'eliminando',
    'eliminada'
  );
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.evidencia_cargas (
  id uuid primary key default gen_random_uuid(),
  tipo public.evidencia_tipo not null,
  actuacion_id uuid not null,
  actor_id uuid not null references auth.users(id),
  bucket_id text not null,
  storage_path text not null unique,
  descripcion text,
  sha256_cliente text not null,
  mime_declarado text not null,
  byte_size_declarado bigint not null,
  estado public.evidencia_carga_estado not null default 'reservada',
  expira_en timestamptz not null,
  lease_token uuid,
  lease_hasta timestamptz,
  evidencia_id uuid,
  ultimo_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalizada_at timestamptz,
  eliminada_at timestamptz,
  constraint evidencia_cargas_tipo_bucket_check check (
    (tipo = 'inspeccion_foto' and bucket_id = 'inspeccion-fotos')
    or
    (tipo = 'expediente_documento' and bucket_id = 'expediente-docs')
  ),
  constraint evidencia_cargas_sha_check check (
    sha256_cliente ~ '^[0-9a-f]{64}$'
  ),
  constraint evidencia_cargas_tamano_check check (
    byte_size_declarado > 0 and byte_size_declarado <= 10485760
  ),
  constraint evidencia_cargas_descripcion_check check (
    descripcion is null or char_length(descripcion) <= 500
  ),
  constraint evidencia_cargas_path_check check (
    storage_path =
      actuacion_id::text || '/' || actor_id::text || '/' || id::text
  )
);

create index if not exists evidencia_cargas_actor_estado_idx
  on public.evidencia_cargas(actor_id, estado);
create index if not exists evidencia_cargas_limpieza_idx
  on public.evidencia_cargas(estado, expira_en, lease_hasta)
  where evidencia_id is null;
create index if not exists evidencia_cargas_actuacion_idx
  on public.evidencia_cargas(tipo, actuacion_id, estado);

alter table public.evidencia_cargas enable row level security;
revoke all on public.evidencia_cargas from anon, authenticated, service_role;
revoke truncate on public.evidencia_cargas from anon, authenticated, service_role;

alter table public.expediente_documentos
  add column if not exists created_by uuid references auth.users(id);

create or replace function public.contexto_evidencia_valido(
  p_tipo public.evidencia_tipo,
  p_actuacion_id uuid,
  p_actor_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rol public.app_rol;
  v_cartel_id text;
begin
  select p.rol
  into v_rol
  from public.perfiles p
  where p.user_id = p_actor_id;
  if not found then
    return false;
  end if;

  if p_tipo = 'inspeccion_foto'::public.evidencia_tipo then
    if not (v_rol = any(
      array['administrador','coordinador','inspector']::public.app_rol[]
    )) then
      return false;
    end if;
    select i.cartel_id
    into v_cartel_id
    from public.inspecciones i
    where i.id = p_actuacion_id;
  else
    if not (v_rol = any(
      array['administrador','coordinador']::public.app_rol[]
    )) then
      return false;
    end if;
    select e.cartel_id
    into v_cartel_id
    from public.expedientes e
    where e.id = p_actuacion_id;
  end if;

  return found and public.cartel_tiene_vinculo_aprobado(v_cartel_id);
end;
$$;

revoke all on function public.contexto_evidencia_valido(
  public.evidencia_tipo, uuid, uuid
) from public, anon, authenticated, service_role;

create or replace function public.iniciar_finalizacion_evidencia(
  p_ticket_id uuid,
  p_actor_id uuid
)
returns table (
  ticket_id uuid,
  estado text,
  evidencia_id uuid,
  tipo text,
  bucket_id text,
  storage_path text,
  sha256_cliente text,
  byte_size_declarado bigint,
  mime_declarado text,
  lease_token uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.evidencia_cargas%rowtype;
  v_lease uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' or p_actor_id is null then
    raise exception 'Funcion tecnica reservada al servicio';
  end if;

  select c.*
  into v_ticket
  from public.evidencia_cargas c
  where c.id = p_ticket_id
  for update;
  if not found or v_ticket.actor_id <> p_actor_id then
    raise exception 'Ticket inexistente o ajeno al actor';
  end if;
  if not public.contexto_evidencia_valido(
    v_ticket.tipo,
    v_ticket.actuacion_id,
    v_ticket.actor_id
  ) then
    raise exception 'El actor, rol, actuacion o vinculo ya no son validos';
  end if;

  if v_ticket.estado = 'finalizada' then
    return query
    select
      v_ticket.id,
      'finalizada'::text,
      v_ticket.evidencia_id,
      v_ticket.tipo::text,
      v_ticket.bucket_id,
      v_ticket.storage_path,
      v_ticket.sha256_cliente,
      v_ticket.byte_size_declarado,
      v_ticket.mime_declarado,
      null::uuid;
    return;
  end if;

  if v_ticket.estado = 'procesando'
     and v_ticket.lease_hasta is not null
     and v_ticket.lease_hasta > now() then
    return query
    select
      v_ticket.id,
      'ocupada'::text,
      null::uuid,
      v_ticket.tipo::text,
      v_ticket.bucket_id,
      v_ticket.storage_path,
      v_ticket.sha256_cliente,
      v_ticket.byte_size_declarado,
      v_ticket.mime_declarado,
      null::uuid;
    return;
  end if;

  if v_ticket.estado not in ('reservada', 'procesando') then
    raise exception 'El ticket ya no admite finalizacion';
  end if;
  if v_ticket.estado = 'reservada' and v_ticket.expira_en <= now() then
    raise exception 'La reserva de carga vencio';
  end if;

  v_lease := gen_random_uuid();
  update public.evidencia_cargas
  set estado = 'procesando',
      lease_token = v_lease,
      lease_hasta = now() + interval '5 minutes',
      ultimo_error = null,
      updated_at = now()
  where id = v_ticket.id;

  return query
  select
    v_ticket.id,
    'procesando'::text,
    null::uuid,
    v_ticket.tipo::text,
    v_ticket.bucket_id,
    v_ticket.storage_path,
    v_ticket.sha256_cliente,
    v_ticket.byte_size_declarado,
    v_ticket.mime_declarado,
    v_lease;
end;
$$;

revoke all on function public.iniciar_finalizacion_evidencia(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.iniciar_finalizacion_evidencia(uuid, uuid)
  to service_role;

create or replace function public.reportar_fallo_finalizacion_evidencia(
  p_ticket_id uuid,
  p_lease_token uuid,
  p_permanente boolean,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.evidencia_cargas%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return false;
  end if;
  select c.*
  into v_ticket
  from public.evidencia_cargas c
  where c.id = p_ticket_id
  for update;
  if not found then
    return false;
  end if;
  if v_ticket.estado = 'finalizada' then
    return true;
  end if;
  if v_ticket.estado <> 'procesando'
     or v_ticket.lease_token is distinct from p_lease_token then
    return false;
  end if;

  update public.evidencia_cargas
  set estado = case
        when coalesce(p_permanente, false) then 'limpieza'::public.evidencia_carga_estado
        else 'reservada'::public.evidencia_carga_estado
      end,
      expira_en = case
        when coalesce(p_permanente, false) then least(expira_en, now())
        else greatest(expira_en, now() + interval '15 minutes')
      end,
      lease_token = null,
      lease_hasta = null,
      ultimo_error = left(coalesce(p_error, 'fallo_sin_detalle'), 300),
      updated_at = now()
  where id = p_ticket_id;
  return true;
end;
$$;

revoke all on function public.reportar_fallo_finalizacion_evidencia(
  uuid, uuid, boolean, text
) from public, anon, authenticated;
grant execute on function public.reportar_fallo_finalizacion_evidencia(
  uuid, uuid, boolean, text
) to service_role;

-- Sustituye el verificador anterior. No consulta ni modifica `storage.objects`;
-- valida que la fila insertada coincida exactamente con el ticket bloqueado.
create or replace function public.validar_alta_evidencia()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket_id uuid;
  v_ticket public.evidencia_cargas%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     or coalesce(current_setting('app.finalizacion_evidencia', true), '') <> 'ticket' then
    raise exception 'La evidencia solo puede finalizarse mediante un ticket verificado';
  end if;
  begin
    v_ticket_id := current_setting('app.evidencia_ticket_id', true)::uuid;
  exception
    when others then
      raise exception 'Falta el ticket de finalizacion';
  end;

  select c.*
  into v_ticket
  from public.evidencia_cargas c
  where c.id = v_ticket_id;
  if not found or v_ticket.estado <> 'procesando' then
    raise exception 'Ticket de evidencia no procesable';
  end if;

  if new.storage_path is distinct from v_ticket.storage_path
     or new.sha256 is distinct from v_ticket.sha256_cliente
     or new.byte_size is distinct from v_ticket.byte_size_declarado
     or new.mime_type is distinct from v_ticket.mime_declarado
     or new.created_by is distinct from v_ticket.actor_id
     or new.descripcion is distinct from v_ticket.descripcion then
    raise exception 'El manifiesto no coincide con la reserva verificada';
  end if;

  if tg_table_name = 'inspeccion_fotos' then
    if v_ticket.tipo <> 'inspeccion_foto'
       or new.inspeccion_id is distinct from v_ticket.actuacion_id then
      raise exception 'El ticket no pertenece a la inspeccion';
    end if;
  elsif tg_table_name = 'expediente_documentos' then
    if v_ticket.tipo <> 'expediente_documento'
       or new.expediente_id is distinct from v_ticket.actuacion_id
       or new.tipo is distinct from v_ticket.mime_declarado then
      raise exception 'El ticket no pertenece al expediente';
    end if;
  else
    raise exception 'Tabla de evidencia no soportada';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_inspeccion_fotos_validar_alta
  on public.inspeccion_fotos;
create trigger trg_inspeccion_fotos_validar_alta
  before insert on public.inspeccion_fotos
  for each row execute function public.validar_alta_evidencia();

drop trigger if exists trg_expediente_documentos_validar_alta
  on public.expediente_documentos;
create trigger trg_expediente_documentos_validar_alta
  before insert on public.expediente_documentos
  for each row execute function public.validar_alta_evidencia();

revoke all on function public.finalizar_evidencia_verificada(
  text, uuid, text, text, text, bigint, text, uuid
) from public, anon, authenticated, service_role;
drop function if exists public.finalizar_evidencia_verificada(
  text, uuid, text, text, text, bigint, text, uuid
);

create or replace function public.completar_finalizacion_evidencia(
  p_ticket_id uuid,
  p_lease_token uuid,
  p_sha256 text,
  p_byte_size bigint,
  p_mime_type text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.evidencia_cargas%rowtype;
  v_id uuid;
  v_cartel_id text;
  v_orden integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Funcion tecnica reservada al servicio';
  end if;
  select c.*
  into v_ticket
  from public.evidencia_cargas c
  where c.id = p_ticket_id
  for update;
  if not found then
    raise exception 'Ticket inexistente';
  end if;
  if v_ticket.estado = 'finalizada' then
    if v_ticket.evidencia_id is null
       or lower(btrim(coalesce(p_sha256, ''))) <> v_ticket.sha256_cliente
       or p_byte_size is distinct from v_ticket.byte_size_declarado
       or lower(btrim(coalesce(p_mime_type, ''))) <> v_ticket.mime_declarado then
      raise exception 'Reintento incompatible con la evidencia finalizada';
    end if;
    return v_ticket.evidencia_id;
  end if;
  if v_ticket.estado <> 'procesando'
     or v_ticket.lease_token is distinct from p_lease_token
     or v_ticket.lease_hasta is null
     or v_ticket.lease_hasta <= now() then
    raise exception 'Lease de finalizacion invalida o vencida';
  end if;
  if lower(btrim(coalesce(p_sha256, ''))) <> v_ticket.sha256_cliente
     or p_byte_size is distinct from v_ticket.byte_size_declarado
     or lower(btrim(coalesce(p_mime_type, ''))) <> v_ticket.mime_declarado then
    raise exception 'Los bytes verificados no coinciden con la reserva';
  end if;

  if v_ticket.tipo = 'inspeccion_foto' then
    select i.cartel_id
    into v_cartel_id
    from public.inspecciones i
    where i.id = v_ticket.actuacion_id
    for update;
  else
    select e.cartel_id
    into v_cartel_id
    from public.expedientes e
    where e.id = v_ticket.actuacion_id
    for update;
  end if;
  if not found
     or not public.contexto_evidencia_valido(
       v_ticket.tipo,
       v_ticket.actuacion_id,
       v_ticket.actor_id
     )
     or not public.cartel_tiene_vinculo_aprobado(v_cartel_id) then
    raise exception 'El contexto administrativo dejo de ser valido';
  end if;

  perform set_config('app.finalizacion_evidencia', 'ticket', true);
  perform set_config('app.evidencia_ticket_id', v_ticket.id::text, true);

  if v_ticket.tipo = 'inspeccion_foto' then
    if (
      select count(*)
      from public.inspeccion_fotos f
      where f.inspeccion_id = v_ticket.actuacion_id
    ) >= 6 then
      raise exception 'La inspeccion ya alcanzo el maximo de 6 fotos';
    end if;
    select coalesce(max(f.orden), -1) + 1
    into v_orden
    from public.inspeccion_fotos f
    where f.inspeccion_id = v_ticket.actuacion_id;

    insert into public.inspeccion_fotos (
      inspeccion_id,
      storage_path,
      descripcion,
      orden,
      sha256,
      byte_size,
      mime_type,
      created_by
    ) values (
      v_ticket.actuacion_id,
      v_ticket.storage_path,
      v_ticket.descripcion,
      v_orden,
      v_ticket.sha256_cliente,
      v_ticket.byte_size_declarado,
      v_ticket.mime_declarado,
      v_ticket.actor_id
    )
    returning id into v_id;
  else
    insert into public.expediente_documentos (
      expediente_id,
      storage_path,
      descripcion,
      tipo,
      sha256,
      byte_size,
      mime_type,
      created_by
    ) values (
      v_ticket.actuacion_id,
      v_ticket.storage_path,
      v_ticket.descripcion,
      v_ticket.mime_declarado,
      v_ticket.sha256_cliente,
      v_ticket.byte_size_declarado,
      v_ticket.mime_declarado,
      v_ticket.actor_id
    )
    returning id into v_id;
  end if;

  update public.evidencia_cargas
  set estado = 'finalizada',
      evidencia_id = v_id,
      finalizada_at = now(),
      lease_token = null,
      lease_hasta = null,
      ultimo_error = null,
      updated_at = now()
  where id = v_ticket.id;
  return v_id;
end;
$$;

revoke all on function public.completar_finalizacion_evidencia(
  uuid, uuid, text, bigint, text
) from public, anon, authenticated;
grant execute on function public.completar_finalizacion_evidencia(
  uuid, uuid, text, bigint, text
) to service_role;

create or replace function public.reclamar_cargas_huerfanas(
  p_limite integer,
  p_worker_token uuid
)
returns table (
  ticket_id uuid,
  bucket_id text,
  storage_path text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     or p_worker_token is null then
    raise exception 'Funcion tecnica reservada al servicio';
  end if;

  return query
  with candidatas as (
    select c.id
    from public.evidencia_cargas c
    where c.evidencia_id is null
      and not exists (
        select 1
        from public.inspeccion_fotos f
        where f.storage_path = c.storage_path
      )
      and not exists (
        select 1
        from public.expediente_documentos d
        where d.storage_path = c.storage_path
      )
      and (
        (
          c.estado in ('reservada', 'limpieza')
          and c.expira_en <= now() - interval '1 hour'
          and c.updated_at <= now() - interval '1 hour'
        )
        or
        (
          c.estado = 'procesando'
          and c.lease_hasta is not null
          and c.lease_hasta <= now() - interval '1 hour'
        )
        or
        (
          c.estado = 'eliminando'
          and c.lease_hasta is not null
          and c.lease_hasta <= now()
        )
      )
    order by c.created_at
    for update skip locked
    limit least(greatest(coalesce(p_limite, 1), 1), 100)
  ),
  reclamadas as (
    update public.evidencia_cargas c
    set estado = 'eliminando',
        lease_token = p_worker_token,
        lease_hasta = now() + interval '10 minutes',
        updated_at = now()
    from candidatas x
    where c.id = x.id
    returning c.id, c.bucket_id, c.storage_path
  )
  select r.id, r.bucket_id, r.storage_path
  from reclamadas r;
end;
$$;

revoke all on function public.reclamar_cargas_huerfanas(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.reclamar_cargas_huerfanas(integer, uuid)
  to service_role;

create or replace function public.confirmar_limpieza_carga(
  p_ticket_id uuid,
  p_worker_token uuid,
  p_eliminada boolean,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.evidencia_cargas%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return false;
  end if;
  select c.*
  into v_ticket
  from public.evidencia_cargas c
  where c.id = p_ticket_id
  for update;
  if not found
     or v_ticket.estado <> 'eliminando'
     or v_ticket.lease_token is distinct from p_worker_token
     or v_ticket.evidencia_id is not null then
    return false;
  end if;

  if coalesce(p_eliminada, false) then
    update public.evidencia_cargas
    set estado = 'eliminada',
        eliminada_at = now(),
        lease_token = null,
        lease_hasta = null,
        ultimo_error = null,
        updated_at = now()
    where id = p_ticket_id;
  else
    update public.evidencia_cargas
    set estado = 'limpieza',
        expira_en = least(expira_en, now()),
        lease_token = null,
        lease_hasta = null,
        ultimo_error = left(coalesce(p_error, 'storage_remove_failed'), 300),
        updated_at = now()
    where id = p_ticket_id;
  end if;
  return true;
end;
$$;

revoke all on function public.confirmar_limpieza_carga(
  uuid, uuid, boolean, text
) from public, anon, authenticated;
grant execute on function public.confirmar_limpieza_carga(
  uuid, uuid, boolean, text
) to service_role;

drop policy if exists inspeccion_fotos_insert on storage.objects;
create policy inspeccion_fotos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'inspeccion-fotos'
    and owner_id = auth.uid()::text
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[])
    and exists (
      select 1
      from public.inspecciones i
      where i.id::text = (storage.foldername(name))[1]
        and public.cartel_tiene_vinculo_aprobado(i.cartel_id)
    )
  );

drop policy if exists expediente_docs_insert on storage.objects;
create policy expediente_docs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'expediente-docs'
    and owner_id = auth.uid()::text
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.tiene_rol(array['administrador','coordinador']::public.app_rol[])
    and exists (
      select 1
      from public.expedientes e
      where e.id::text = (storage.foldername(name))[1]
        and public.cartel_tiene_vinculo_aprobado(e.cartel_id)
    )
  );

-- No se agregan triggers ni columnas al esquema administrado `storage`.
-- Supabase indica tratarlo como read-only y operar los objetos por su API.
-- La app queda sin policies de UPDATE/DELETE; service_role sigue siendo una
-- frontera tecnica confiable y solo se reserva para mantenimiento de huerfanos.

-- El limite de 10 MB y los MIME permitidos se configuran mediante Dashboard o
-- Storage API. Esta migracion no modifica tablas del esquema administrado.

create or replace function public.reservar_carga_evidencia(
  p_tipo text,
  p_actuacion_id uuid,
  p_descripcion text,
  p_sha256_cliente text,
  p_byte_size_declarado bigint,
  p_mime_declarado text
)
returns table (
  ticket_id uuid,
  bucket_id text,
  storage_path text,
  expira_en timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_rol public.app_rol;
  v_tipo public.evidencia_tipo;
  v_bucket_id text;
  v_ticket_id uuid := gen_random_uuid();
  v_storage_path text;
  v_expira_en timestamptz := now() + interval '2 hours';
  v_sha text := lower(btrim(coalesce(p_sha256_cliente, '')));
  v_mime text := lower(btrim(coalesce(p_mime_declarado, '')));
  v_cartel_id text;
  v_count bigint;
begin
  if v_actor_id is null or coalesce(auth.role(), '') <> 'authenticated' then
    raise exception 'Se requiere una sesion autenticada';
  end if;
  begin
    v_tipo := p_tipo::public.evidencia_tipo;
  exception
    when invalid_text_representation then
      raise exception 'Tipo de evidencia invalido';
  end;

  select p.rol
  into v_rol
  from public.perfiles p
  where p.user_id = v_actor_id;
  if not found then
    raise exception 'La cuenta no tiene un perfil municipal valido';
  end if;
  if v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'SHA-256 declarado invalido';
  end if;
  if p_byte_size_declarado is null
     or p_byte_size_declarado <= 0
     or p_byte_size_declarado > 10485760 then
    raise exception 'Tamano de evidencia invalido';
  end if;
  if char_length(btrim(coalesce(p_descripcion, ''))) > 500 then
    raise exception 'La descripcion supera 500 caracteres';
  end if;

  if v_tipo = 'inspeccion_foto'::public.evidencia_tipo then
    if not (v_rol = any(
      array['administrador','coordinador','inspector']::public.app_rol[]
    )) then
      raise exception 'Rol no autorizado para incorporar fotos';
    end if;
    if v_mime not in (
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic'
    ) then
      raise exception 'MIME de fotografia no permitido';
    end if;
    v_bucket_id := 'inspeccion-fotos';
  else
    if not (v_rol = any(
      array['administrador','coordinador']::public.app_rol[]
    )) then
      raise exception 'Rol no autorizado para incorporar documentos';
    end if;
    if v_mime not in (
      'application/pdf',
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic'
    ) then
      raise exception 'MIME de documento no permitido';
    end if;
    v_bucket_id := 'expediente-docs';
  end if;

  -- Serializa las reservas por actor y por actuacion.
  perform pg_advisory_xact_lock(hashtext(v_actor_id::text));
  select count(*)
  into v_count
  from public.evidencia_cargas c
  where c.actor_id = v_actor_id
    and c.estado in ('reservada', 'procesando', 'limpieza', 'eliminando');
  if v_count >= 8 then
    raise exception 'La cuenta alcanzo el maximo de 8 cargas tecnicas abiertas';
  end if;

  if v_tipo = 'inspeccion_foto'::public.evidencia_tipo then
    select i.cartel_id
    into v_cartel_id
    from public.inspecciones i
    where i.id = p_actuacion_id
    for update;
    if not found then
      raise exception 'Inspeccion inexistente';
    end if;
    if not public.cartel_tiene_vinculo_aprobado(v_cartel_id) then
      raise exception 'El cartel requiere un vinculo territorial aprobado';
    end if;

    select
      (select count(*)
       from public.inspeccion_fotos f
       where f.inspeccion_id = p_actuacion_id)
      +
      (select count(*)
       from public.evidencia_cargas c
       where c.tipo = 'inspeccion_foto'
         and c.actuacion_id = p_actuacion_id
         and c.estado in ('reservada', 'procesando'))
    into v_count;
    if v_count >= 6 then
      raise exception 'La inspeccion ya alcanzo el maximo de 6 fotos o reservas';
    end if;
  else
    select e.cartel_id
    into v_cartel_id
    from public.expedientes e
    where e.id = p_actuacion_id
    for update;
    if not found then
      raise exception 'Expediente inexistente';
    end if;
    if not public.cartel_tiene_vinculo_aprobado(v_cartel_id) then
      raise exception 'El cartel requiere un vinculo territorial aprobado';
    end if;

    select count(*)
    into v_count
    from public.evidencia_cargas c
    where c.tipo = 'expediente_documento'
      and c.actuacion_id = p_actuacion_id
      and c.estado in ('reservada', 'procesando');
    if v_count >= 8 then
      raise exception 'El expediente alcanzo el maximo de 8 cargas tecnicas abiertas';
    end if;
  end if;

  v_storage_path :=
    p_actuacion_id::text || '/' || v_actor_id::text || '/' || v_ticket_id::text;

  insert into public.evidencia_cargas (
    id,
    tipo,
    actuacion_id,
    actor_id,
    bucket_id,
    storage_path,
    descripcion,
    sha256_cliente,
    mime_declarado,
    byte_size_declarado,
    estado,
    expira_en
  ) values (
    v_ticket_id,
    v_tipo,
    p_actuacion_id,
    v_actor_id,
    v_bucket_id,
    v_storage_path,
    nullif(btrim(coalesce(p_descripcion, '')), ''),
    v_sha,
    v_mime,
    p_byte_size_declarado,
    'reservada',
    v_expira_en
  );

  return query
  select v_ticket_id, v_bucket_id, v_storage_path, v_expira_en;
end;
$$;

revoke all on function public.reservar_carga_evidencia(
  text, uuid, text, text, bigint, text
) from public, anon, service_role;
grant execute on function public.reservar_carga_evidencia(
  text, uuid, text, text, bigint, text
) to authenticated;

create or replace function public.abandonar_carga_evidencia(
  p_ticket_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.evidencia_cargas%rowtype;
begin
  if auth.uid() is null or coalesce(auth.role(), '') <> 'authenticated' then
    return false;
  end if;
  select c.*
  into v_ticket
  from public.evidencia_cargas c
  where c.id = p_ticket_id
    and c.actor_id = auth.uid()
  for update;
  if not found then
    return false;
  end if;
  if v_ticket.estado = 'limpieza' then
    return true;
  end if;
  if v_ticket.estado <> 'reservada' then
    return false;
  end if;

  update public.evidencia_cargas
  set estado = 'limpieza',
      expira_en = least(expira_en, now()),
      ultimo_error = 'upload_abandonado',
      updated_at = now()
  where id = p_ticket_id;
  return true;
end;
$$;

revoke all on function public.abandonar_carga_evidencia(uuid)
  from public, anon, service_role;
grant execute on function public.abandonar_carga_evidencia(uuid)
  to authenticated;

create or replace function public.puede_subir_evidencia(
  p_bucket_id text,
  p_storage_path text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.evidencia_cargas c
      where c.actor_id = auth.uid()
        and c.bucket_id = p_bucket_id
        and c.storage_path = p_storage_path
        and c.estado = 'reservada'
        and c.expira_en > now()
        and public.contexto_evidencia_valido(c.tipo, c.actuacion_id, c.actor_id)
    );
$$;

revoke all on function public.puede_subir_evidencia(text, text)
  from public, anon, service_role;
grant execute on function public.puede_subir_evidencia(text, text)
  to authenticated;

drop policy if exists inspeccion_fotos_insert on storage.objects;
create policy inspeccion_fotos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'inspeccion-fotos'
    and owner_id = auth.uid()::text
    and public.puede_subir_evidencia(bucket_id, name)
  );

drop policy if exists expediente_docs_insert on storage.objects;
create policy expediente_docs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'expediente-docs'
    and owner_id = auth.uid()::text
    and public.puede_subir_evidencia(bucket_id, name)
  );

drop policy if exists inspeccion_fotos_read on storage.objects;
create policy inspeccion_fotos_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'inspeccion-fotos'
    and public.tiene_rol(
      array['administrador','coordinador','inspector','consulta']::public.app_rol[]
    )
    and (
      owner_id = auth.uid()::text
      or exists (
        select 1
        from public.inspeccion_fotos f
        where f.storage_path = name
      )
    )
  );

drop policy if exists expediente_docs_read on storage.objects;
create policy expediente_docs_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'expediente-docs'
    and public.tiene_rol(
      array['administrador','coordinador','inspector','consulta']::public.app_rol[]
    )
    and (
      owner_id = auth.uid()::text
      or exists (
        select 1
        from public.expediente_documentos d
        where d.storage_path = name
      )
    )
  );

-- ----------------------------------------------------------------------------
-- 7. Corpus RAG privado, trazable y con cuota distribuida
-- ----------------------------------------------------------------------------
-- Ningun documento es publico, revisado o apto para IA externa por omision.
-- La huella del PDF fuente se conserva separada de la huella del texto
-- normalizado: ambas son necesarias para evaluar procedencia y version.
-- Supabase instala extensiones en `extensions`. El search_path de la RPC
-- incluye ambos esquemas para seguir siendo idempotente si una base heredada
-- ya tuviera pgcrypto en `public`.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.rag_documentos
  add column if not exists source_pdf_hash text,
  add column if not exists ingest_contract_version integer not null default 0,
  add column if not exists audience text not null default 'interno',
  add column if not exists human_reviewed boolean not null default false,
  add column if not exists external_ai_allowed boolean not null default false,
  add column if not exists ocr_confidence numeric(5,2),
  add column if not exists ocr_doubtful boolean not null default true;

update public.rag_documentos
set audience = 'interno'
where audience is null or audience not in ('publico', 'interno');

update public.rag_documentos
set human_reviewed = false
where human_reviewed is null;

update public.rag_documentos
set external_ai_allowed = false
where external_ai_allowed is null;

update public.rag_documentos
set ocr_doubtful = true
where ocr_doubtful is null;

update public.rag_documentos
set contenido_hash = case
  when btrim(contenido_hash) ~* '^[0-9a-f]{64}$'
    then lower(btrim(contenido_hash))
  else null
end
where contenido_hash is not null;

update public.rag_documentos
set source_pdf_hash = case
  when btrim(source_pdf_hash) ~* '^[0-9a-f]{64}$'
    then lower(btrim(source_pdf_hash))
  else null
end
where source_pdf_hash is not null;

-- Una revision solo puede referirse al contrato que vuelve a calcular la
-- huella desde los chunks realmente persistidos.
update public.rag_documentos
set human_reviewed = false,
    external_ai_allowed = false
where human_reviewed
  and (
    ingest_contract_version <> 1
    or contenido_hash is null
    or source_pdf_hash is null
  );

-- Una autorizacion externa nunca sobrevive a metadata incompleta o insegura.
update public.rag_documentos
set external_ai_allowed = false
where external_ai_allowed
  and (
    audience <> 'publico'
    or not human_reviewed
    or ingest_contract_version <> 1
    or ocr_doubtful
    or contenido_hash is null
    or source_pdf_hash is null
  );

alter table public.rag_documentos
  alter column audience set default 'interno',
  alter column audience set not null,
  alter column human_reviewed set default false,
  alter column human_reviewed set not null,
  alter column external_ai_allowed set default false,
  alter column external_ai_allowed set not null,
  alter column ocr_doubtful set default true,
  alter column ocr_doubtful set not null;

alter table public.rag_documentos
  drop constraint if exists rag_documentos_contenido_hash_check,
  add constraint rag_documentos_contenido_hash_check
    check (
      contenido_hash is null
      or contenido_hash ~ '^[0-9a-f]{64}$'
    ),
  drop constraint if exists rag_documentos_source_pdf_hash_check,
  add constraint rag_documentos_source_pdf_hash_check
    check (
      source_pdf_hash is null
      or source_pdf_hash ~ '^[0-9a-f]{64}$'
    ),
  drop constraint if exists rag_documentos_ingest_contract_check,
  add constraint rag_documentos_ingest_contract_check
    check (ingest_contract_version between 0 and 1),
  drop constraint if exists rag_documentos_audience_check,
  add constraint rag_documentos_audience_check
    check (audience in ('publico', 'interno')),
  drop constraint if exists rag_documentos_ocr_confidence_check,
  add constraint rag_documentos_ocr_confidence_check
    check (
      ocr_confidence is null
      or (ocr_confidence >= 0 and ocr_confidence <= 100)
    ),
  drop constraint if exists rag_documentos_human_review_guard,
  add constraint rag_documentos_human_review_guard
    check (
      not human_reviewed
      or (
        ingest_contract_version = 1
        and contenido_hash is not null
        and source_pdf_hash is not null
      )
    ),
  drop constraint if exists rag_documentos_external_ai_guard,
  add constraint rag_documentos_external_ai_guard
    check (
      not external_ai_allowed
      or (
        audience = 'publico'
        and human_reviewed
        and ingest_contract_version = 1
        and not ocr_doubtful
        and contenido_hash is not null
        and source_pdf_hash is not null
      )
    );

comment on column public.rag_documentos.source_pdf_hash is
  'SHA-256 hexadecimal de los bytes del PDF fuente.';
comment on column public.rag_documentos.contenido_hash is
  'SHA-256 del manifiesto canonico de chunks: orden, pagina, seccion y contenido.';
comment on column public.rag_documentos.ingest_contract_version is
  'Version del contrato atomico de ingesta; 0 identifica contenido heredado.';
comment on column public.rag_documentos.audience is
  'Audiencia documental: interno por omision; publico requiere clasificacion explicita.';
comment on column public.rag_documentos.human_reviewed is
  'Indica que una persona autorizada reviso esta version del contenido.';
comment on column public.rag_documentos.external_ai_allowed is
  'Permiso explicito para enviar esta version a un proveedor externo.';
comment on column public.rag_documentos.ocr_confidence is
  'Confianza media del OCR en porcentaje; NULL si se extrajo texto nativo.';
comment on column public.rag_documentos.ocr_doubtful is
  'Marca conservadora: true si alguna pagina OCR requiere revision.';

-- RLS queda como defensa adicional. La aplicacion no recibe SELECT directo:
-- el retrieval se ejecuta en una ruta server-side con cuota previa.
alter table public.rag_documentos enable row level security;
alter table public.rag_chunks enable row level security;

drop policy if exists rag_documentos_read on public.rag_documentos;
create policy rag_documentos_read on public.rag_documentos
  for select
  to authenticated
  using (
    public.tiene_rol(
      array[
        'administrador',
        'coordinador',
        'inspector',
        'consulta'
      ]::public.app_rol[]
    )
  );

drop policy if exists rag_chunks_read on public.rag_chunks;
create policy rag_chunks_read on public.rag_chunks
  for select
  to authenticated
  using (
    public.tiene_rol(
      array[
        'administrador',
        'coordinador',
        'inspector',
        'consulta'
      ]::public.app_rol[]
    )
  );

revoke all on table public.rag_documentos
  from public, anon, authenticated;
revoke all on table public.rag_chunks
  from public, anon, authenticated;
revoke insert, update, delete, truncate on table public.rag_documentos
  from service_role;
revoke insert, update, delete, truncate on table public.rag_chunks
  from service_role;
grant select on table public.rag_documentos to service_role;
grant select on table public.rag_chunks to service_role;

-- El script offline reemplaza catalogo y chunks dentro de una unica
-- transaccion. Si cambia el PDF, el texto, la audiencia o la condicion OCR, se
-- revoca cualquier revision/permiso previo hasta una nueva decision humana.
create or replace function public.sincronizar_documento_rag(
  p_documento jsonb,
  p_chunks jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id text := nullif(btrim(coalesce(p_documento->>'id', '')), '');
  v_titulo text := nullif(btrim(coalesce(p_documento->>'titulo', '')), '');
  v_categoria text := nullif(btrim(coalesce(p_documento->>'categoria', '')), '');
  v_pdf_url text := nullif(btrim(coalesce(p_documento->>'pdf_url', '')), '');
  v_contenido_hash text := lower(btrim(coalesce(p_documento->>'contenido_hash', '')));
  v_source_pdf_hash text := lower(btrim(coalesce(p_documento->>'source_pdf_hash', '')));
  v_audience text := lower(btrim(coalesce(p_documento->>'audience', 'interno')));
  v_paginas integer;
  v_chunks integer;
  v_ingest_contract_version integer;
  v_ocr_confidence numeric(5,2);
  v_ocr_doubtful boolean;
  v_existing public.rag_documentos%rowtype;
  v_had_existing boolean := false;
  v_preserve_review boolean := false;
  v_actual_chunks integer;
  v_canonical_manifest text;
  v_computed_hash text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'La ingesta RAG requiere el proceso tecnico autorizado'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p_documento) <> 'object' then
    raise exception 'Metadata RAG invalida';
  end if;
  if v_id is null
     or v_titulo is null
     or v_categoria is null
     or v_pdf_url is null then
    raise exception 'La metadata documental obligatoria esta incompleta';
  end if;
  if v_contenido_hash !~ '^[0-9a-f]{64}$'
     or v_source_pdf_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Las huellas documentales deben ser SHA-256 validos';
  end if;
  if v_audience not in ('publico', 'interno') then
    raise exception 'Audiencia documental invalida';
  end if;

  begin
    v_paginas := (p_documento->>'paginas')::integer;
    v_chunks := (p_documento->>'chunks')::integer;
    v_ingest_contract_version :=
      (p_documento->>'ingest_contract_version')::integer;
    v_ocr_doubtful := (p_documento->>'ocr_doubtful')::boolean;
    if p_documento->>'ocr_confidence' is not null then
      v_ocr_confidence := (p_documento->>'ocr_confidence')::numeric(5,2);
    end if;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Metadata numerica o booleana invalida';
  end;

  if v_paginas is null or v_paginas <= 0
     or v_chunks is null or v_chunks <= 0 or v_chunks > 5000
     or v_ingest_contract_version is distinct from 1
     or v_ocr_doubtful is null
     or (
       v_ocr_confidence is not null
       and (v_ocr_confidence < 0 or v_ocr_confidence > 100)
     ) then
    raise exception 'Conteos o metadata OCR fuera de rango';
  end if;

  select d.*
  into v_existing
  from public.rag_documentos d
  where d.id = v_id
  for update;
  v_had_existing := found;
  v_preserve_review :=
    p_chunks is null
    and v_had_existing
    and v_existing.ingest_contract_version = 1
    and v_existing.contenido_hash is not distinct from v_contenido_hash
    and v_existing.source_pdf_hash is not distinct from v_source_pdf_hash
    and v_existing.audience is not distinct from v_audience
    and v_existing.paginas is not distinct from v_paginas
    and v_existing.chunks is not distinct from v_chunks
    and v_existing.ocr_confidence is not distinct from v_ocr_confidence
    and v_existing.ocr_doubtful is not distinct from v_ocr_doubtful;

  if p_chunks is null then
    if not v_had_existing
       or v_existing.ingest_contract_version <> 1
       or v_existing.contenido_hash is distinct from v_contenido_hash
       or v_existing.source_pdf_hash is distinct from v_source_pdf_hash
       or v_existing.paginas is distinct from v_paginas
       or v_existing.chunks is distinct from v_chunks then
      raise exception 'Una version documental nueva requiere todos sus chunks';
    end if;
  else
    if jsonb_typeof(p_chunks) <> 'array'
       or jsonb_array_length(p_chunks) <> v_chunks then
      raise exception 'El lote de chunks no coincide con el catalogo';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_chunks) as items(item)
      where jsonb_typeof(item) <> 'object'
         or coalesce(item->>'pagina', '') !~ '^[0-9]+$'
         or coalesce(item->>'orden', '') !~ '^[0-9]+$'
         or nullif(btrim(coalesce(item->>'contenido', '')), '') is null
         or coalesce(item->>'seccion', '')
              is distinct from btrim(coalesce(item->>'seccion', ''))
         or case
              when jsonb_typeof(item->'embedding') = 'array'
                then jsonb_array_length(item->'embedding') <> 384
              else true
            end
    ) then
      raise exception 'El lote contiene un chunk invalido';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_chunks) as items(item)
      where (item->>'pagina')::integer < 1
         or (item->>'pagina')::integer > v_paginas
    ) then
      raise exception 'Un chunk referencia una pagina inexistente';
    end if;
    if not exists (
      select 1
      from (
        select
          count(distinct (item->>'orden')::integer) as ordenes,
          min((item->>'orden')::integer) as orden_minimo,
          max((item->>'orden')::integer) as orden_maximo
        from jsonb_array_elements(p_chunks) as items(item)
      ) as lote
      where lote.ordenes = v_chunks
        and lote.orden_minimo = 0
        and lote.orden_maximo = v_chunks - 1
    ) then
      raise exception 'Los ordenes de chunks deben ser unicos y contiguos desde cero';
    end if;

    select string_agg(
      (item->>'orden')::integer::text
        || ':' || (item->>'pagina')::integer::text
        || ':' || octet_length(coalesce(item->>'seccion', ''))::text
        || ':' || coalesce(item->>'seccion', '')
        || ':' || octet_length(item->>'contenido')::text
        || ':' || (item->>'contenido'),
      E'\n'
      order by (item->>'orden')::integer
    )
    into v_canonical_manifest
    from jsonb_array_elements(p_chunks) as items(item);

    v_computed_hash := encode(
      digest(convert_to(v_canonical_manifest, 'UTF8'), 'sha256'),
      'hex'
    );
    if v_computed_hash is distinct from v_contenido_hash then
      raise exception 'La huella del contenido no coincide con el lote de chunks';
    end if;
  end if;

  insert into public.rag_documentos as actual (
    id,
    titulo,
    categoria,
    pdf_url,
    contenido_hash,
    source_pdf_hash,
    ingest_contract_version,
    paginas,
    chunks,
    audience,
    human_reviewed,
    external_ai_allowed,
    ocr_confidence,
    ocr_doubtful,
    ingestado_en
  ) values (
    v_id,
    v_titulo,
    v_categoria,
    v_pdf_url,
    v_contenido_hash,
    v_source_pdf_hash,
    v_ingest_contract_version,
    v_paginas,
    v_chunks,
    v_audience,
    false,
    false,
    v_ocr_confidence,
    v_ocr_doubtful,
    now()
  )
  on conflict (id) do update
  set titulo = excluded.titulo,
      categoria = excluded.categoria,
      pdf_url = excluded.pdf_url,
      contenido_hash = excluded.contenido_hash,
      source_pdf_hash = excluded.source_pdf_hash,
      ingest_contract_version = excluded.ingest_contract_version,
      paginas = excluded.paginas,
      chunks = excluded.chunks,
      audience = excluded.audience,
      human_reviewed = case
        when v_preserve_review then actual.human_reviewed
        else false
      end,
      external_ai_allowed = case
        when v_preserve_review
             and excluded.audience = 'publico'
             and not excluded.ocr_doubtful
          then actual.external_ai_allowed
        else false
      end,
      ocr_confidence = excluded.ocr_confidence,
      ocr_doubtful = excluded.ocr_doubtful,
      ingestado_en = now();

  if p_chunks is not null then
    delete from public.rag_chunks c
    where c.documento_id = v_id;

    insert into public.rag_chunks (
      documento_id,
      pagina,
      seccion,
      contenido,
      orden,
      embedding
    )
    select
      v_id,
      (item->>'pagina')::integer,
      nullif(btrim(coalesce(item->>'seccion', '')), ''),
      item->>'contenido',
      (item->>'orden')::integer,
      (item->'embedding')::text::vector(384)
    from jsonb_array_elements(p_chunks) as items(item);
  end if;

  select count(*)
  into v_actual_chunks
  from public.rag_chunks c
  where c.documento_id = v_id;
  if v_actual_chunks <> v_chunks then
    raise exception 'La cantidad real de chunks no coincide con el catalogo';
  end if;

  return true;
end;
$$;

revoke all on function public.sincronizar_documento_rag(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.sincronizar_documento_rag(jsonb, jsonb)
  to service_role;

-- Retrieval acotado y exclusivamente server-side. Hay que eliminar la firma
-- anterior porque cambia el tipo de retorno.
drop function if exists public.match_rag_chunks(
  vector, integer, double precision
);

create function public.match_rag_chunks(
  query_embedding vector(384),
  match_count integer default 8,
  min_similarity double precision default 0.35
)
returns table (
  id uuid,
  documento_id text,
  pagina integer,
  seccion text,
  contenido text,
  similarity double precision,
  contenido_hash text,
  source_pdf_hash text,
  ingest_contract_version integer,
  human_reviewed boolean,
  external_ai_allowed boolean,
  audience text,
  ocr_doubtful boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with limites as (
    select
      least(greatest(coalesce(match_count, 8), 1), 8) as max_rows,
      least(
        greatest(coalesce(min_similarity, 0.35), 0.35),
        1.0
      ) as similarity_floor
  )
  select
    c.id,
    c.documento_id,
    c.pagina,
    c.seccion,
    c.contenido,
    score.similarity,
    d.contenido_hash,
    d.source_pdf_hash,
    d.ingest_contract_version,
    d.human_reviewed,
    d.external_ai_allowed,
    d.audience,
    d.ocr_doubtful
  from public.rag_chunks c
  join public.rag_documentos d
    on d.id = c.documento_id
  cross join limites l
  cross join lateral (
    select 1 - (c.embedding <=> query_embedding) as similarity
  ) score
  where c.embedding is not null
    and score.similarity >= l.similarity_floor
  order by c.embedding <=> query_embedding
  limit (select max_rows from limites);
$$;

revoke all on function public.match_rag_chunks(
  vector, integer, double precision
) from public, anon, authenticated;
grant execute on function public.match_rag_chunks(
  vector, integer, double precision
) to service_role;

comment on function public.match_rag_chunks(
  vector, integer, double precision
) is
  'Busca server-side hasta 8 chunks con similitud minima 0.35.';

-- Cuota atomica por actor y scope, compartida entre instancias serverless.
create table if not exists public.api_cuotas (
  actor_id uuid not null references auth.users(id) on delete cascade,
  scope text not null,
  ventana_inicio timestamptz not null,
  cantidad integer not null,
  updated_at timestamptz not null default now(),
  primary key (actor_id, scope),
  constraint api_cuotas_scope_check
    check (scope in ('normativa')),
  constraint api_cuotas_cantidad_check
    check (cantidad >= 1)
);

alter table public.api_cuotas enable row level security;
revoke all on table public.api_cuotas
  from public, anon, authenticated, service_role;

create or replace function public.consumir_cuota_api(
  p_scope text
)
returns table (
  permitido boolean,
  reintentar_en integer
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_scope text := lower(btrim(coalesce(p_scope, '')));
  v_now timestamptz := clock_timestamp();
  v_ventana interval := interval '60 seconds';
  v_limite integer := 10;
  v_inicio timestamptz;
  v_cantidad integer;
begin
  if v_actor_id is null
     or coalesce(auth.role(), '') <> 'authenticated'
     or not public.tiene_rol(
       array[
         'administrador',
         'coordinador',
         'inspector',
         'consulta'
       ]::public.app_rol[]
     ) then
    raise exception 'Se requiere un perfil municipal autenticado'
      using errcode = '42501';
  end if;

  if v_scope <> 'normativa' then
    raise exception 'Scope de cuota no permitido'
      using errcode = '22023';
  end if;

  insert into public.api_cuotas as cuota (
    actor_id,
    scope,
    ventana_inicio,
    cantidad,
    updated_at
  )
  values (
    v_actor_id,
    v_scope,
    v_now,
    1,
    v_now
  )
  on conflict (actor_id, scope) do update
  set ventana_inicio = case
        when v_now >= cuota.ventana_inicio + v_ventana then v_now
        else cuota.ventana_inicio
      end,
      cantidad = case
        when v_now >= cuota.ventana_inicio + v_ventana then 1
        else least(cuota.cantidad, v_limite) + 1
      end,
      updated_at = v_now
  returning cuota.ventana_inicio, cuota.cantidad
  into v_inicio, v_cantidad;

  permitido := v_cantidad <= v_limite;
  reintentar_en := case
    when permitido then 0
    else greatest(
      1,
      ceil(extract(epoch from ((v_inicio + v_ventana) - v_now)))::integer
    )
  end;
  return next;
end;
$$;

revoke all on function public.consumir_cuota_api(text)
  from public, anon, service_role;
grant execute on function public.consumir_cuota_api(text)
  to authenticated;

-- Keepalive deliberadamente inocuo: no abre lectura sobre el corpus.
create or replace function public.keepalive_ping()
returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  select true;
$$;

revoke all on function public.keepalive_ping()
  from public;
grant execute on function public.keepalive_ping()
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 8. La bitacora de auditoria no admite reescritura, ni con service_role
-- ----------------------------------------------------------------------------
create or replace function public.proteger_auditoria_inmutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'La bitacora de auditoria es inmutable';
end;
$$;

drop trigger if exists trg_auditoria_eventos_inmutable on public.auditoria_eventos;
create trigger trg_auditoria_eventos_inmutable
  before update or delete on public.auditoria_eventos
  for each row execute function public.proteger_auditoria_inmutable();

-- Solo los triggers SECURITY DEFINER de auditoria pueden anexar eventos.
revoke insert, update, delete on public.auditoria_eventos
  from anon, authenticated, service_role;

comment on column public.inspeccion_fotos.sha256 is
  'SHA-256 hexadecimal del archivo. NULL solo para evidencia heredada anterior a la fase 13.';
comment on column public.expediente_documentos.sha256 is
  'SHA-256 hexadecimal del archivo. NULL solo para evidencia heredada anterior a la fase 13.';
comment on function public.solicitar_vinculo_cartel(text, text, text) is
  'Postula o corrige un vinculo territorial. Siempre genera estado pendiente y exige fundamento.';
comment on function public.resolver_vinculo_cartel(text, boolean, text) is
  'Aprueba o rechaza un vinculo pendiente. Solo administrador autenticado; service_role no aprueba.';

commit;
