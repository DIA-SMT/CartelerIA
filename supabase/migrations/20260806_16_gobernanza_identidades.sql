-- ============================================================================
-- Fase 16 - Gobernanza de identidades y privacidad consultiva
-- ----------------------------------------------------------------------------
-- Ejecutar despues de 20260731_15_busqueda_lexica_serverless.sql.
--
-- Objetivos:
--   1. Asignar un rol deja de ser un UPDATE a mano: exige administrador
--      autenticado, fundamento y traza inmutable.
--   2. Ni service_role puede mover un rol sin pasar por la RPC auditada.
--   3. El rol `consulta` deja de ver empresa, CUIT y padron por cualquier via:
--      carteles, inspecciones y expedientes.
--   4. Las lecturas de datos sensibles y de evidencia dejan rastro. La
--      evidencia se autoriza en el servidor y en la misma transaccion que su
--      registro de auditoria: si el registro falla, no hay URL.
--
-- La migracion es idempotente. No modifica roles ya asignados ni actuaciones
-- existentes.
--
-- Nota de nomenclatura: el esquema usa `created_at` en las cuatro tablas de
-- historial existentes. Las columnas fisicas nuevas mantienen esa convencion;
-- las RPC exponen nombres en espanol porque son contrato de interfaz, no
-- esquema.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Historial inmutable de asignaciones de rol
-- ----------------------------------------------------------------------------
-- El rol es la llave de todo el sistema de permisos. Hasta ahora era el unico
-- dato administrativo que cambiaba sin fundamento ni autor registrado.
--
-- Las FK a `auth.users` no cascadean ni anulan, igual que `auditoria_eventos`
-- (migracion 12): eliminar una cuenta con historial de roles exige decidir
-- antes que hacer con su traza.
--
-- No es una omision: en una tabla inmutable, `on delete cascade` dispararia el
-- trigger de proteccion y fallaria igual, pero con un mensaje mucho mas
-- confuso, y `on delete set null` tambien, porque el trigger rechaza UPDATE.
-- Restringir es la unica opcion coherente. Consecuencia a conocer: borrar una
-- cuenta desde el Dashboard de Supabase falla mientras conserve traza. Ya
-- pasaba con `auditoria_eventos` desde la migracion 12.
create table if not exists public.perfiles_historial (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id),
  rol_anterior public.app_rol,
  rol_nuevo    public.app_rol not null,
  fundamento   text not null,
  actor_id     uuid references auth.users(id),
  actor_nombre text,
  actor_rol    public.app_rol,
  created_at   timestamptz not null default now()
);

create index if not exists perfiles_historial_user_idx
  on public.perfiles_historial(user_id, created_at desc);

comment on table public.perfiles_historial is
  'Traza inmutable de cambios de rol. Solo la escribe public.asignar_rol.';

alter table public.perfiles_historial enable row level security;

drop policy if exists perfiles_historial_select_admin on public.perfiles_historial;
create policy perfiles_historial_select_admin on public.perfiles_historial
  for select to authenticated
  using (public.tiene_rol(array['administrador']::public.app_rol[]));

drop trigger if exists trg_perfiles_historial_inmutable on public.perfiles_historial;
create trigger trg_perfiles_historial_inmutable
  before update or delete on public.perfiles_historial
  for each row execute function public.proteger_historial_legal_inmutable();

revoke all on public.perfiles_historial from anon, authenticated;
grant select on public.perfiles_historial to authenticated;
revoke insert, update, delete on public.perfiles_historial
  from anon, authenticated, service_role;

-- TRUNCATE no ejecuta triggers por fila ni se somete a RLS.
revoke truncate on table
  public.perfiles,
  public.perfiles_historial
from anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Unica via para cambiar un rol
-- ----------------------------------------------------------------------------
-- Mismas guardas que el resto del flujo administrativo: identidad humana
-- (service_role excluido a proposito), fundamento minimo y traza en la misma
-- transaccion. Devuelve false cuando el rol pedido ya es el vigente, para no
-- ensuciar el historial con no-ops.
create or replace function public.asignar_rol(
  p_user_id uuid,
  p_rol public.app_rol,
  p_fundamento text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rol_actual public.app_rol;
  v_actor_nombre text;
  v_actor_rol public.app_rol;
  v_otros_administradores integer;
begin
  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or not public.tiene_rol(array['administrador']::public.app_rol[]) then
    raise exception 'Solo un administrador autenticado puede asignar roles'
      using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'La cuenta afectada es obligatoria'
      using errcode = '22023';
  end if;
  if p_rol is null then
    raise exception 'El rol a asignar es obligatorio'
      using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_fundamento, ''))) < 12 then
    raise exception 'El fundamento del cambio de rol debe tener al menos 12 caracteres'
      using errcode = '22023';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Nadie puede cambiar su propio rol'
      using errcode = '42501';
  end if;

  -- Serializa las asignaciones entre si. El `for update` de abajo bloquea solo
  -- la fila del afectado: dos administradores degradandose mutuamente en
  -- paralelo veian cada uno al otro y dejaban la instancia sin ninguno.
  perform pg_advisory_xact_lock(hashtext('public.asignar_rol'));

  select p.rol
  into v_rol_actual
  from public.perfiles p
  where p.user_id = p_user_id
  for update;
  if not found then
    raise exception 'La cuenta afectada no tiene perfil municipal'
      using errcode = '23503';
  end if;

  if v_rol_actual = p_rol then
    return false;
  end if;

  -- Una instancia sin administradores no se puede recuperar desde la
  -- aplicacion: la RPC exige administrador y el trigger cierra el UPDATE
  -- directo. El bloqueo es deliberado.
  if v_rol_actual = 'administrador'::public.app_rol
     and p_rol <> 'administrador'::public.app_rol then
    select count(*)
    into v_otros_administradores
    from public.perfiles p
    where p.rol = 'administrador'::public.app_rol
      and p.user_id <> p_user_id;
    if v_otros_administradores = 0 then
      raise exception 'La instancia no puede quedarse sin administradores'
        using errcode = '23514';
    end if;
  end if;

  select p.nombre, p.rol
  into v_actor_nombre, v_actor_rol
  from public.perfiles p
  where p.user_id = auth.uid();

  perform set_config('app.asignacion_rol', p_user_id::text, true);
  update public.perfiles
  set rol = p_rol
  where user_id = p_user_id;

  insert into public.perfiles_historial (
    user_id,
    rol_anterior,
    rol_nuevo,
    fundamento,
    actor_id,
    actor_nombre,
    actor_rol
  ) values (
    p_user_id,
    v_rol_actual,
    p_rol,
    btrim(p_fundamento),
    auth.uid(),
    v_actor_nombre,
    v_actor_rol
  );

  return true;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Cierre del camino directo sobre perfiles
-- ----------------------------------------------------------------------------
-- Hasta ahora `perfiles` solo tenia policy de SELECT: a `authenticated` lo
-- frenaba la ausencia de policy de escritura, no un revoke. El trigger agrega
-- la barrera que falta contra service_role y contra el SQL Editor.
--
-- Si un incidente dejara la instancia sin administradores, la recuperacion
-- exige una migracion deliberada que documente el hecho. No hay atajo silencioso.
--
-- `service_role` entra en el revoke: sin el, un DELETE + INSERT sobre `perfiles`
-- cambiaba un rol esquivando el trigger de UPDATE, sin fundamento ni traza.
revoke insert, update, delete on public.perfiles from anon, authenticated, service_role;

create or replace function public.proteger_rol_perfiles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marcador text;
begin
  -- Un perfil nuevo nace siempre en `consulta`, como hace el trigger de alta.
  -- Sin esta rama, borrar el perfil y volver a insertarlo era un ascenso sin
  -- fundamento que el trigger de UPDATE nunca veia.
  if tg_op = 'INSERT' then
    if new.rol is distinct from 'consulta'::public.app_rol then
      raise exception 'Un perfil nuevo solo puede nacer con rol consulta'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- La identidad y el alta no cambian nunca, se toque o no el rol.
  if new.user_id is distinct from old.user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'La identidad y el alta de un perfil son inmutables'
      using errcode = '42501';
  end if;

  -- El nombre y el resto del perfil siguen siendo editables por quien tenga
  -- permiso: de acá para abajo se protege exclusivamente la columna `rol`.
  if new.rol is not distinct from old.rol then
    return new;
  end if;

  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or not public.tiene_rol(array['administrador']::public.app_rol[]) then
    raise exception 'El rol solo puede cambiarlo un administrador autenticado'
      using errcode = '42501';
  end if;

  v_marcador := coalesce(current_setting('app.asignacion_rol', true), '');
  if v_marcador <> old.user_id::text then
    raise exception 'El rol solo puede cambiarse mediante public.asignar_rol, con fundamento'
      using errcode = '42501';
  end if;

  if old.user_id = auth.uid() then
    raise exception 'Nadie puede cambiar su propio rol'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_perfiles_proteger_rol on public.perfiles;
create trigger trg_perfiles_proteger_rol
  before insert or update on public.perfiles
  for each row execute function public.proteger_rol_perfiles();

-- ----------------------------------------------------------------------------
-- 4. Fuente del panel de usuarios
-- ----------------------------------------------------------------------------
-- El email vive en auth.users y no se replica en perfiles: por eso la funcion
-- es security definer. Devuelve solo lo que el panel muestra.
drop function if exists public.listar_perfiles();
create function public.listar_perfiles()
returns table (
  user_id uuid,
  nombre text,
  email text,
  rol public.app_rol,
  creado_en timestamptz,
  rol_cambiado_en timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or not public.tiene_rol(array['administrador']::public.app_rol[]) then
    raise exception 'Solo un administrador autenticado puede enumerar los perfiles'
      using errcode = '42501';
  end if;

  return query
  select
    p.user_id,
    p.nombre,
    u.email::text,
    p.rol,
    p.created_at,
    (
      select max(h.created_at)
      from public.perfiles_historial h
      where h.user_id = p.user_id
    )
  from public.perfiles p
  left join auth.users u on u.id = p.user_id
  order by p.created_at asc;
end;
$$;

-- `revoke ... from public` no alcanza: Supabase tiene un `alter default
-- privileges` que otorga execute directo a anon en cada funcion nueva, y un
-- revoke a `public` no toca un grant directo.
revoke all on function public.asignar_rol(uuid, public.app_rol, text) from public, anon;
revoke all on function public.listar_perfiles() from public, anon;
grant execute on function public.asignar_rol(uuid, public.app_rol, text) to authenticated;
grant execute on function public.listar_perfiles() to authenticated;

comment on function public.asignar_rol(uuid, public.app_rol, text) is
  'Unica via para cambiar un rol: administrador humano, fundamento y traza.';
comment on function public.listar_perfiles() is
  'Enumera perfiles con email y ultimo cambio de rol. Solo administrador.';
comment on function public.proteger_rol_perfiles() is
  'Rechaza todo UPDATE de perfiles.rol que no provenga de public.asignar_rol.';

-- ----------------------------------------------------------------------------
-- 5. El rol `consulta` deja de ver datos personales y tributarios
-- ----------------------------------------------------------------------------
-- Hasta la migracion 13, `consulta` recibia la misma clausula `using` que un
-- administrador. Empresa, CUIT y padron estan ademas duplicados en
-- `inspecciones` y `expedientes`: restringir solo `carteles` dejaria la fuga
-- abierta por esas dos tablas.
--
-- Las vistas corren con los privilegios de su propietario (no `security_invoker`)
-- para poder leer la tabla base que la nueva policy le cierra a `consulta`, y
-- llevan su propia guarda de rol adentro: sin perfil municipal reconocido no
-- devuelven ninguna fila. `security_barrier` evita que un predicado ajeno se
-- evalue antes que esa guarda.
drop view if exists public.carteles_consulta;
create view public.carteles_consulta
with (security_barrier = true) as
  select
    c.id,
    c.territorial_feature_id,
    c.territorial_feature_id_propuesto,
    c.vinculo_estado,
    c.vinculo_solicitado_en,
    c.vinculo_aprobado_en,
    c.tipo_cartel,
    c.dimensiones,
    c.superficie_m2,
    c.domicilio,
    c.numero,
    c.google_maps_url,
    c.estado,
    c.latitud,
    c.longitud,
    c.location_source,
    c.status,
    c.contamination_level,
    c.zone,
    c.street_view_image_url,
    c.original_latitud,
    c.original_longitud,
    c.location_edited,
    c.created_at,
    c.updated_at
  from public.carteles c
  where public.tiene_rol(
    array['administrador','coordinador','inspector','consulta']::public.app_rol[]
  );

comment on view public.carteles_consulta is
  'Registro administrativo sin empresa, CUIT ni padron. Omite ademas quien solicito y quien aprobo el vinculo.';

drop view if exists public.inspecciones_consulta;
create view public.inspecciones_consulta
with (security_barrier = true) as
  select
    i.id,
    i.cartel_id,
    i.estado,
    i.tipo_soporte,
    i.ancho_m,
    i.alto_m,
    i.superficie_m2,
    i.observaciones,
    i.programada_para,
    i.inspeccionada_en,
    i.created_at,
    i.updated_at
  from public.inspecciones i
  where public.tiene_rol(
    array['administrador','coordinador','inspector','consulta']::public.app_rol[]
  );

comment on view public.inspecciones_consulta is
  'Inspecciones sin empresa ni CUIT. Omite ademas inspector_id y created_by de ESTA tabla; los historiales siguen mostrando actor.';

drop view if exists public.expedientes_consulta;
create view public.expedientes_consulta
with (security_barrier = true) as
  select
    e.id,
    e.numero,
    e.cartel_id,
    e.estado,
    e.direccion,
    e.observaciones,
    e.created_at,
    e.updated_at,
    e.cerrado_en
  from public.expedientes e
  where public.tiene_rol(
    array['administrador','coordinador','inspector','consulta']::public.app_rol[]
  );

comment on view public.expedientes_consulta is
  'Expedientes sin razon social. Omite ademas created_by de ESTA tabla; los historiales siguen mostrando actor.';

revoke all on public.carteles_consulta from anon, authenticated;
revoke all on public.inspecciones_consulta from anon, authenticated;
revoke all on public.expedientes_consulta from anon, authenticated;
grant select on public.carteles_consulta to authenticated;
grant select on public.inspecciones_consulta to authenticated;
grant select on public.expedientes_consulta to authenticated;

-- Las tablas base quedan reservadas a los roles operativos.
drop policy if exists carteles_authenticated_read on public.carteles;
create policy carteles_authenticated_read on public.carteles
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector']::public.app_rol[]
    )
  );

drop policy if exists inspecciones_select on public.inspecciones;
create policy inspecciones_select on public.inspecciones
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector']::public.app_rol[]
    )
  );

drop policy if exists expedientes_select on public.expedientes;
create policy expedientes_select on public.expedientes
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector']::public.app_rol[]
    )
  );

-- `inspeccion_fotos` y `expediente_documentos` no exponen datos personales en
-- columnas: el binario se cierra por Storage en la seccion 6. Queda anotado
-- que `descripcion` es texto libre donde un agente podria tipear un CUIT; lo
-- mismo vale para `nota` en los historiales y `fundamento` en los vinculos.
-- Son campos redactados por personas, no columnas estructuradas, y su cierre
-- exigiria revisar contenido, no permisos.
--
-- Tampoco se tocan las policies de los historiales (`inspeccion_historial`,
-- `expediente_historial`, `cartel_vinculo_historial`) ni las de evidencia, que
-- siguen mostrandole a `consulta` el nombre y rol del agente que actuo. Es
-- deliberado: saber quien resolvio una actuacion es parte de la trazabilidad
-- publica del expediente, no un dato personal a proteger. Lo que se cierra es
-- el dato del ADMINISTRADO (empresa, CUIT, padron), no el del agente.

-- ----------------------------------------------------------------------------
-- 6. Auditoria de lectura de datos sensibles
-- ----------------------------------------------------------------------------
-- Las escrituras tienen bitacora inmutable desde la migracion 12; las lecturas
-- no dejaban rastro. Nadie podia saber quien consulto un CUIT ni quien
-- descargo una fotografia.
create table if not exists public.acceso_datos_sensibles (
  id         bigint generated always as identity primary key,
  actor_id   uuid not null references auth.users(id),
  actor_rol  public.app_rol,
  recurso    text not null,
  recurso_id text not null,
  motivo     text,
  created_at timestamptz not null default now(),
  constraint acceso_datos_sensibles_recurso_check
    check (
      recurso in (
        'cartel_datos_fiscales',
        'inspeccion_foto',
        'expediente_documento'
      )
    )
);

create index if not exists acceso_datos_sensibles_actor_idx
  on public.acceso_datos_sensibles(actor_id, created_at desc);
create index if not exists acceso_datos_sensibles_recurso_idx
  on public.acceso_datos_sensibles(recurso, recurso_id, created_at desc);

comment on table public.acceso_datos_sensibles is
  'Registro insert-only de lecturas de datos fiscales y de evidencia.';

alter table public.acceso_datos_sensibles enable row level security;

drop policy if exists acceso_datos_sensibles_select_admin on public.acceso_datos_sensibles;
create policy acceso_datos_sensibles_select_admin on public.acceso_datos_sensibles
  for select to authenticated
  using (public.tiene_rol(array['administrador']::public.app_rol[]));

drop trigger if exists trg_acceso_datos_sensibles_inmutable on public.acceso_datos_sensibles;
create trigger trg_acceso_datos_sensibles_inmutable
  before update or delete on public.acceso_datos_sensibles
  for each row execute function public.proteger_historial_legal_inmutable();

revoke all on public.acceso_datos_sensibles from anon, authenticated;
grant select on public.acceso_datos_sensibles to authenticated;
revoke insert, update, delete on public.acceso_datos_sensibles
  from anon, authenticated, service_role;
revoke truncate on table public.acceso_datos_sensibles
  from anon, authenticated, service_role;

-- Unica via de escritura. La ruta de evidencia corre con service_role y por eso
-- puede declarar el actor; una sesion de navegador solo puede registrarse a si
-- misma.
create or replace function public.registrar_acceso_sensible(
  p_recurso text,
  p_recurso_id text,
  p_motivo text default null,
  p_actor_id uuid default null
)
returns bigint
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_rol public.app_rol;
  v_id bigint;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    v_actor := p_actor_id;
  else
    v_actor := auth.uid();
    if p_actor_id is not null and p_actor_id <> v_actor then
      raise exception 'Una sesion solo puede registrar sus propios accesos'
        using errcode = '42501';
    end if;
  end if;
  if v_actor is null then
    raise exception 'El registro de acceso exige un actor identificado'
      using errcode = '42501';
  end if;

  if p_recurso is null
     or p_recurso not in (
       'cartel_datos_fiscales',
       'inspeccion_foto',
       'expediente_documento'
     ) then
    raise exception 'Recurso sensible no reconocido'
      using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_recurso_id, ''))) = 0 then
    raise exception 'El recurso accedido es obligatorio'
      using errcode = '22023';
  end if;

  -- Fail-closed: sin perfil municipal reconocido no hay acceso que registrar.
  select p.rol
  into v_rol
  from public.perfiles p
  where p.user_id = v_actor;
  if not found then
    raise exception 'La cuenta no tiene perfil municipal habilitado'
      using errcode = '42501';
  end if;

  insert into public.acceso_datos_sensibles (
    actor_id,
    actor_rol,
    recurso,
    recurso_id,
    motivo
  ) values (
    v_actor,
    v_rol,
    p_recurso,
    btrim(p_recurso_id),
    nullif(btrim(left(coalesce(p_motivo, ''), 300)), '')
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.registrar_acceso_sensible(text, text, text, uuid)
  from public, anon;
grant execute on function public.registrar_acceso_sensible(text, text, text, uuid)
  to authenticated, service_role;

comment on function public.registrar_acceso_sensible(text, text, text, uuid) is
  'Unica via de escritura de la auditoria de lectura de datos sensibles.';

-- ----------------------------------------------------------------------------
-- 7. La evidencia se autoriza en el servidor, no en el navegador
-- ----------------------------------------------------------------------------
-- Firmar URLs desde el navegador contra un objeto legible por cualquier
-- autenticado haria trivialmente evitable cualquier auditoria. Esta RPC
-- resuelve la ruta y registra el acceso en la MISMA transaccion: si el registro
-- falla, la ruta no se devuelve. El fail-closed lo impone PostgreSQL, no el
-- control de flujo de la ruta Next.
-- Recibe el lote completo que abre una ficha: si una sola pieza no se puede
-- auditar, la transaccion entera se deshace y no se entrega ninguna ruta.
create or replace function public.autorizar_lectura_evidencia(
  p_recurso text,
  p_recurso_ids uuid[],
  p_actor_id uuid,
  p_motivo text default null
)
returns table (
  recurso_id uuid,
  bucket_id text,
  storage_path text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_actor uuid;
  v_rol public.app_rol;
  v_bucket text;
  v_ids uuid[];
  v_id uuid;
  v_hallados uuid[];
  v_rutas text[];
begin
  if coalesce(auth.role(), '') = 'service_role' then
    v_actor := p_actor_id;
  else
    v_actor := auth.uid();
    if p_actor_id is not null and p_actor_id <> v_actor then
      raise exception 'Una sesion solo puede autorizar su propia lectura'
        using errcode = '42501';
    end if;
  end if;
  if v_actor is null then
    raise exception 'La lectura de evidencia exige un actor identificado'
      using errcode = '42501';
  end if;

  select array_agg(distinct id)
  into v_ids
  from unnest(coalesce(p_recurso_ids, array[]::uuid[])) as id
  where id is not null;
  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'La evidencia solicitada es obligatoria'
      using errcode = '22023';
  end if;
  if array_length(v_ids, 1) > 40 then
    raise exception 'Se solicitaron demasiadas piezas de evidencia a la vez'
      using errcode = '22023';
  end if;

  -- `consulta` conserva acceso a la evidencia. Es deliberado: una fotografia de
  -- un cartel en la via publica no es un dato personal del administrado, y sin
  -- ella el rol consultivo no puede verificar nada. Lo que cambia respecto de
  -- antes es que ahora cada lectura queda registrada con nombre y rol.
  select p.rol
  into v_rol
  from public.perfiles p
  where p.user_id = v_actor;
  if not found
     or v_rol not in (
       'administrador'::public.app_rol,
       'coordinador'::public.app_rol,
       'inspector'::public.app_rol,
       'consulta'::public.app_rol
     ) then
    raise exception 'La cuenta no tiene perfil municipal habilitado'
      using errcode = '42501';
  end if;

  if p_recurso = 'inspeccion_foto' then
    v_bucket := 'inspeccion-fotos';
    select array_agg(f.id order by f.id), array_agg(f.storage_path order by f.id)
    into v_hallados, v_rutas
    from public.inspeccion_fotos f
    where f.id = any(v_ids);
  elsif p_recurso = 'expediente_documento' then
    v_bucket := 'expediente-docs';
    select array_agg(d.id order by d.id), array_agg(d.storage_path order by d.id)
    into v_hallados, v_rutas
    from public.expediente_documentos d
    where d.id = any(v_ids);
  else
    raise exception 'Recurso de evidencia no reconocido'
      using errcode = '22023';
  end if;

  -- Entrega total o nada: pedir una pieza inexistente invalida el lote entero.
  if v_hallados is null
     or coalesce(array_length(v_hallados, 1), 0) <> array_length(v_ids, 1) then
    raise exception 'La evidencia solicitada no existe'
      using errcode = '23503';
  end if;

  foreach v_id in array v_hallados loop
    perform public.registrar_acceso_sensible(
      p_recurso,
      v_id::text,
      p_motivo,
      v_actor
    );
  end loop;

  return query
  select pieza.id, v_bucket, pieza.ruta
  from unnest(v_hallados, v_rutas) as pieza(id, ruta);
end;
$$;

revoke all on function public.autorizar_lectura_evidencia(text, uuid[], uuid, text)
  from public, anon, authenticated;
grant execute on function public.autorizar_lectura_evidencia(text, uuid[], uuid, text)
  to service_role;

comment on function public.autorizar_lectura_evidencia(text, uuid[], uuid, text) is
  'Resuelve las rutas de un lote de evidencia y audita el acceso en la misma transaccion.';

-- Cuota distribuida para la ruta de evidencia: no depende de la memoria de una
-- instancia serverless. El limite es mas alto que el de normativa porque abrir
-- una ficha pide varias fotografias de una sola vez.
alter table public.api_cuotas drop constraint if exists api_cuotas_scope_check;
alter table public.api_cuotas add constraint api_cuotas_scope_check
  check (scope in ('normativa', 'evidencia'));

create or replace function public.consumir_cuota_evidencia(
  p_actor_id uuid
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
  v_now timestamptz := clock_timestamp();
  v_ventana interval := interval '60 seconds';
  v_limite integer := 60;
  v_inicio timestamptz;
  v_cantidad integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'La cuota de evidencia solo la consume la ruta autorizada'
      using errcode = '42501';
  end if;
  if p_actor_id is null then
    raise exception 'La cuota exige un actor identificado'
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
    p_actor_id,
    'evidencia',
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

revoke all on function public.consumir_cuota_evidencia(uuid)
  from public, anon, authenticated;
grant execute on function public.consumir_cuota_evidencia(uuid)
  to service_role;

-- Se retira la lectura de evidencia AJENA, que es la que hacia evitable la
-- auditoria: hasta ahora cualquier autenticado podia firmar cualquier objeto
-- manifestado, con abrir la consola. Queda solo el objeto propio.
--
-- No se dropean las policies del todo a proposito: un INSERT con RETURNING
-- somete la fila nueva tambien a las policies de SELECT, y storage-api devuelve
-- el metadata del objeto recien creado. Sin policy de lectura, el upload de
-- evidencia falla. Ni tsc, ni el build, ni los tests lo detectarian: se veria
-- recien al intentar cargar una fotografia.
--
-- Que un agente pueda volver a firmar lo que el mismo subio no abre nada: ya
-- tiene el archivo. La ruta /api/evidence/access sigue siendo la unica via para
-- leer evidencia de otras actuaciones, y esa si queda auditada.
drop policy if exists inspeccion_fotos_read on storage.objects;
create policy inspeccion_fotos_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'inspeccion-fotos'
    and owner_id = auth.uid()::text
  );

drop policy if exists expediente_docs_read on storage.objects;
create policy expediente_docs_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'expediente-docs'
    and owner_id = auth.uid()::text
  );

commit;
