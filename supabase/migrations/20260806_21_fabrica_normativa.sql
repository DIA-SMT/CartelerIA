-- ============================================================================
-- Fase 21 - Fabrica Normativa: el articulado en construccion
-- ----------------------------------------------------------------------------
-- Ejecutar despues de 20260806_20_corpus_estado_legal.sql.
--
-- Esta migracion CRECE mientras se construye el paquete: a las tablas y la
-- siembra se le van sumando las RPC de edicion, aprobacion, parametros,
-- diagnosticos y observaciones. Conviene aplicarla cuando el paquete este
-- cerrado, no antes, para no terminar con media docena de migraciones sueltas.
-- Es idempotente, asi que reaplicarla no rompe nada.
--
-- Regla que gobierna todo: la persona es la autora y el sistema asiste. De ahi
-- que nada nazca aprobado, que el asistente no pueda escribir en estas tablas y
-- que el historial sea insert-only.
-- ============================================================================

begin;
-- ----------------------------------------------------------------------------
-- 3. El proyecto de ordenanza en construccion
-- ----------------------------------------------------------------------------
-- El modelo admite varios proyectos desde el principio, aunque la pantalla
-- muestre el activo: normalizar despues, con datos adentro, sale caro.
create table if not exists public.norma_proyecto (
  id                  uuid primary key default gen_random_uuid(),
  titulo              text not null,
  objeto              text,
  estado              text not null default 'borrador',
  documento_origen_id text references public.rag_documentos(id),
  creado_por          uuid references auth.users(id),
  creado_en           timestamptz not null default now(),
  constraint norma_proyecto_estado_check
    check (estado in ('borrador', 'en_revision', 'cerrado', 'elevado'))
);

comment on table public.norma_proyecto is
  'Ordenanza en construccion. El articulado vive en norma_articulo, no en el corpus.';

-- `orden` es lo que manda; `numero` se recalcula al ensamblar, para que
-- reordenar no obligue a renumerar a mano.
--
-- `texto_original` guarda lo que decia el borrador recibido y no se modifica
-- nunca: poder mostrar que decia antes es innegociable cuando hay que explicar
-- por que se cambio.
create table if not exists public.norma_articulo (
  id             uuid primary key default gen_random_uuid(),
  proyecto_id    uuid not null references public.norma_proyecto(id) on delete cascade,
  numero         integer,
  orden          integer not null,
  sumilla        text,
  texto          text not null,
  estado         text not null default 'propuesto',
  origen         text not null,
  texto_original text,
  autor_id       uuid references auth.users(id),
  aprobado_por   uuid references auth.users(id),
  aprobado_en    timestamptz,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint norma_articulo_estado_check
    check (estado in ('propuesto', 'en_revision', 'aprobado', 'descartado')),
  constraint norma_articulo_origen_check
    check (origen in ('borrador_recibido', 'redactado', 'asistente'))
);

create index if not exists norma_articulo_proyecto_idx
  on public.norma_articulo(proyecto_id, orden);

create unique index if not exists norma_articulo_orden_uidx
  on public.norma_articulo(proyecto_id, orden);

comment on column public.norma_articulo.texto_original is
  'Texto del borrador recibido. Inmutable: es el antecedente para explicar un cambio.';

-- Historial inmutable: cada guardado crea una version, nada se sobrescribe.
-- `origen` vive tambien en la version, no solo en el articulo: un articulo que
-- llego del borrador puede recibir despues un texto propuesto por el asistente,
-- y hay que poder decir de donde salio CADA redaccion, no solo la primera.
create table if not exists public.norma_articulo_version (
  id          uuid primary key default gen_random_uuid(),
  articulo_id uuid not null references public.norma_articulo(id) on delete cascade,
  version     integer not null,
  texto       text not null,
  sumilla     text,
  origen      text not null default 'redactado',
  autor_id    uuid references auth.users(id),
  autor_rol   public.app_rol,
  motivo      text,
  creado_en   timestamptz not null default now(),
  constraint norma_articulo_version_origen_check
    check (origen in ('borrador_recibido', 'redactado', 'asistente'))
);

alter table public.norma_articulo_version
  add column if not exists origen text not null default 'redactado';

create unique index if not exists norma_articulo_version_uidx
  on public.norma_articulo_version(articulo_id, version);

comment on table public.norma_articulo_version is
  'Insert-only e inmutable. Cada guardado agrega una fila; el texto anterior queda.';

alter table public.norma_proyecto          enable row level security;
alter table public.norma_articulo          enable row level security;
alter table public.norma_articulo_version  enable row level security;

-- Lectura para todo perfil municipal reconocido, incluido `consulta`: el rol
-- consultivo observa el proyecto (bloque 6) y para eso necesita leerlo. El
-- articulado no contiene datos personales del administrado.
drop policy if exists norma_proyecto_select on public.norma_proyecto;
create policy norma_proyecto_select on public.norma_proyecto
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector','consulta']::public.app_rol[]
    )
  );

drop policy if exists norma_articulo_select on public.norma_articulo;
create policy norma_articulo_select on public.norma_articulo
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector','consulta']::public.app_rol[]
    )
  );

drop policy if exists norma_articulo_version_select on public.norma_articulo_version;
create policy norma_articulo_version_select on public.norma_articulo_version
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector','consulta']::public.app_rol[]
    )
  );

-- La escritura no pasa por policies: va exclusivamente por RPC auditadas, igual
-- que el resto del flujo administrativo.
revoke insert, update, delete on public.norma_proyecto
  from anon, authenticated, service_role;
revoke insert, update, delete on public.norma_articulo
  from anon, authenticated, service_role;
revoke insert, update, delete on public.norma_articulo_version
  from anon, authenticated, service_role;

-- TRUNCATE no ejecuta triggers por fila ni se somete a RLS.
revoke truncate on table
  public.norma_proyecto,
  public.norma_articulo,
  public.norma_articulo_version
from anon, authenticated, service_role;

-- Mismos disparadores que la bitacora legal de la migracion 13.
drop trigger if exists trg_norma_articulo_version_inmutable on public.norma_articulo_version;
create trigger trg_norma_articulo_version_inmutable
  before update or delete on public.norma_articulo_version
  for each row execute function public.proteger_historial_legal_inmutable();

-- `texto_original` no cambia una vez sembrado. Es la unica columna del sistema
-- que se protege por si misma: todo lo demas se versiona, esto se conserva.
create or replace function public.proteger_texto_original_articulo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.texto_original is not null
     and new.texto_original is distinct from old.texto_original then
    raise exception 'El texto original del borrador es inmutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_norma_articulo_texto_original on public.norma_articulo;
create trigger trg_norma_articulo_texto_original
  before update on public.norma_articulo
  for each row execute function public.proteger_texto_original_articulo();

-- ----------------------------------------------------------------------------
-- 4. Alta del proyecto y siembra del articulado
-- ----------------------------------------------------------------------------
-- Las corre el script de ingesta con service_role. Sembrar articulos en estado
-- `propuesto` no es una aprobacion: nada nace aprobado y ninguna de estas dos
-- funciones puede poner un articulo en `aprobado`.
create or replace function public.crear_proyecto_norma(
  p_titulo text,
  p_objeto text,
  p_documento_origen_id text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'El alta de un proyecto la realiza el script de ingesta'
      using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_titulo, ''))) < 4 then
    raise exception 'El proyecto necesita un titulo'
      using errcode = '22023';
  end if;

  -- Idempotente: un borrador da origen a un solo proyecto. Reejecutar la
  -- ingesta devuelve el que ya existe en vez de crear un duplicado que
  -- despues nadie sabria cual es el bueno.
  select p.id into v_id
  from public.norma_proyecto p
  where p.documento_origen_id = p_documento_origen_id
  limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.norma_proyecto (titulo, objeto, documento_origen_id)
  values (btrim(p_titulo), nullif(btrim(coalesce(p_objeto, '')), ''), p_documento_origen_id)
  returning id into v_id;

  return v_id;
end;
$$;

-- Siembra el articulado a partir del corte por articulo del borrador.
--
-- Falla si el proyecto ya tiene articulos. Es deliberado y es la decision mas
-- importante de esta funcion: si manana llega un borrador corregido y alguien
-- lo reingiere, actualizar en silencio pisaria el trabajo de quien ya edito un
-- articulo, y esa perdida no se recupera. Que falle y avise obliga a decidir a
-- una persona.
create or replace function public.sembrar_articulado(
  p_proyecto_id uuid,
  p_articulos jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_existentes integer;
  v_insertados integer := 0;
  v_item jsonb;
  v_articulo_id uuid;
  v_orden integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'La siembra del articulado la realiza el script de ingesta'
      using errcode = '42501';
  end if;
  if p_proyecto_id is null then
    raise exception 'El proyecto es obligatorio'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_articulos) <> 'array' or jsonb_array_length(p_articulos) = 0 then
    raise exception 'No hay articulos que sembrar'
      using errcode = '22023';
  end if;

  select count(*) into v_existentes
  from public.norma_articulo a
  where a.proyecto_id = p_proyecto_id;
  if v_existentes > 0 then
    raise exception 'El proyecto ya tiene % articulos: la siembra no pisa trabajo hecho', v_existentes
      using errcode = '23505';
  end if;

  for v_item in select * from jsonb_array_elements(p_articulos) loop
    v_orden := v_orden + 1;

    insert into public.norma_articulo (
      proyecto_id,
      numero,
      orden,
      sumilla,
      texto,
      texto_original,
      estado,
      origen
    ) values (
      p_proyecto_id,
      nullif(v_item->>'numero', '')::integer,
      v_orden,
      nullif(btrim(coalesce(v_item->>'sumilla', '')), ''),
      coalesce(v_item->>'texto', ''),
      coalesce(v_item->>'texto', ''),
      'propuesto',
      'borrador_recibido'
    )
    returning id into v_articulo_id;

    -- Version 1: el texto tal como llego. El historial arranca en el borrador,
    -- no en la primera edicion.
    insert into public.norma_articulo_version (
      articulo_id,
      version,
      texto,
      sumilla,
      origen,
      motivo
    ) values (
      v_articulo_id,
      1,
      coalesce(v_item->>'texto', ''),
      nullif(btrim(coalesce(v_item->>'sumilla', '')), ''),
      'borrador_recibido',
      'Texto del borrador recibido'
    );

    v_insertados := v_insertados + 1;
  end loop;

  return v_insertados;
end;
$$;

revoke all on function public.crear_proyecto_norma(text, text, text)
  from public, anon, authenticated;
revoke all on function public.sembrar_articulado(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.crear_proyecto_norma(text, text, text) to service_role;
grant execute on function public.sembrar_articulado(uuid, jsonb) to service_role;

comment on function public.sembrar_articulado(uuid, jsonb) is
  'Siembra el articulado del borrador. Falla si el proyecto ya tiene articulos: no pisa trabajo hecho.';

-- ----------------------------------------------------------------------------
-- 5. Escribir, versionar y aprobar
-- ----------------------------------------------------------------------------
-- Identidad de quien escribe. Se repite en tres RPC, asi que se resuelve una
-- sola vez: persona autenticada, con perfil, y nunca service_role.
create or replace function public.actor_fabrica()
returns table (actor_id uuid, actor_rol public.app_rol)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' then
    raise exception 'La Fabrica Normativa exige una persona autenticada'
      using errcode = '42501';
  end if;

  return query
  select p.user_id, p.rol
  from public.perfiles p
  where p.user_id = auth.uid();
end;
$$;

revoke all on function public.actor_fabrica() from public, anon;
grant execute on function public.actor_fabrica() to authenticated;

-- Guardar NO sobrescribe: agrega una version y actualiza el texto vigente del
-- articulo. El motivo es obligatorio desde el segundo guardado, que en la
-- practica es siempre para los articulos sembrados: su version 1 es el borrador.
create or replace function public.guardar_articulo(
  p_articulo_id uuid,
  p_texto text,
  p_sumilla text,
  p_motivo text,
  p_origen text default 'redactado'
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_rol public.app_rol;
  v_estado text;
  v_versiones integer;
  v_siguiente integer;
begin
  select a.actor_id, a.actor_rol into v_actor, v_rol from public.actor_fabrica() a;
  if v_rol is null or v_rol not in (
    'administrador'::public.app_rol,
    'coordinador'::public.app_rol,
    'inspector'::public.app_rol
  ) then
    raise exception 'Escribir el articulado exige un rol operativo'
      using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_texto, ''))) < 20 then
    raise exception 'El texto del articulo es demasiado corto'
      using errcode = '22023';
  end if;
  if p_origen not in ('borrador_recibido', 'redactado', 'asistente') then
    raise exception 'Origen de redaccion no reconocido'
      using errcode = '22023';
  end if;

  select a.estado into v_estado
  from public.norma_articulo a
  where a.id = p_articulo_id
  for update;
  if not found then
    raise exception 'El articulo no existe'
      using errcode = '23503';
  end if;

  -- Un articulo aprobado no se edita en silencio: primero vuelve a revision,
  -- con fundamento. Si no, una aprobacion podria quedar cubriendo un texto que
  -- nadie aprobo.
  if v_estado = 'aprobado' then
    raise exception 'Un articulo aprobado debe volver a revision antes de editarse'
      using errcode = '42501';
  end if;
  if v_estado = 'descartado' then
    raise exception 'Un articulo descartado no se edita'
      using errcode = '42501';
  end if;

  select count(*) into v_versiones
  from public.norma_articulo_version v
  where v.articulo_id = p_articulo_id;

  if v_versiones > 0 and char_length(btrim(coalesce(p_motivo, ''))) < 12 then
    raise exception 'A partir del segundo guardado el motivo del cambio es obligatorio (12 caracteres)'
      using errcode = '22023';
  end if;

  v_siguiente := v_versiones + 1;

  insert into public.norma_articulo_version (
    articulo_id, version, texto, sumilla, origen, autor_id, autor_rol, motivo
  ) values (
    p_articulo_id,
    v_siguiente,
    btrim(p_texto),
    nullif(btrim(coalesce(p_sumilla, '')), ''),
    p_origen,
    v_actor,
    v_rol,
    nullif(btrim(coalesce(p_motivo, '')), '')
  );

  update public.norma_articulo
  set texto = btrim(p_texto),
      sumilla = nullif(btrim(coalesce(p_sumilla, '')), ''),
      autor_id = v_actor,
      actualizado_en = now()
  where id = p_articulo_id;

  return v_siguiente;
end;
$$;

-- Redactar un articulo nuevo. Nace `propuesto` y con su version 1.
create or replace function public.crear_articulo(
  p_proyecto_id uuid,
  p_texto text,
  p_sumilla text,
  p_origen text default 'redactado'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_rol public.app_rol;
  v_orden integer;
  v_id uuid;
begin
  select a.actor_id, a.actor_rol into v_actor, v_rol from public.actor_fabrica() a;
  if v_rol is null or v_rol not in (
    'administrador'::public.app_rol,
    'coordinador'::public.app_rol,
    'inspector'::public.app_rol
  ) then
    raise exception 'Escribir el articulado exige un rol operativo'
      using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_texto, ''))) < 20 then
    raise exception 'El texto del articulo es demasiado corto'
      using errcode = '22023';
  end if;
  if p_origen not in ('redactado', 'asistente') then
    raise exception 'Un articulo nuevo no puede declararse como recibido en el borrador'
      using errcode = '22023';
  end if;

  select coalesce(max(a.orden), 0) + 1 into v_orden
  from public.norma_articulo a
  where a.proyecto_id = p_proyecto_id;

  insert into public.norma_articulo (
    proyecto_id, orden, sumilla, texto, estado, origen, autor_id
  ) values (
    p_proyecto_id,
    v_orden,
    nullif(btrim(coalesce(p_sumilla, '')), ''),
    btrim(p_texto),
    'propuesto',
    p_origen,
    v_actor
  )
  returning id into v_id;

  insert into public.norma_articulo_version (
    articulo_id, version, texto, sumilla, origen, autor_id, autor_rol, motivo
  ) values (
    v_id, 1, btrim(p_texto),
    nullif(btrim(coalesce(p_sumilla, '')), ''),
    p_origen, v_actor, v_rol, 'Redaccion inicial'
  );

  return v_id;
end;
$$;

-- Los estados se mueven con fundamento, igual que el resto del sistema.
-- Aprobar exige administrador o coordinador; un articulo descartado se
-- conserva, nunca se borra.
create or replace function public.cambiar_estado_articulo(
  p_articulo_id uuid,
  p_estado text,
  p_fundamento text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_rol public.app_rol;
  v_actual text;
begin
  select a.actor_id, a.actor_rol into v_actor, v_rol from public.actor_fabrica() a;
  if v_rol is null then
    raise exception 'La cuenta no tiene perfil municipal habilitado'
      using errcode = '42501';
  end if;
  if p_estado not in ('propuesto', 'en_revision', 'aprobado', 'descartado') then
    raise exception 'Estado de articulo no reconocido'
      using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_fundamento, ''))) < 12 then
    raise exception 'El cambio de estado exige un fundamento de al menos 12 caracteres'
      using errcode = '22023';
  end if;

  select a.estado into v_actual
  from public.norma_articulo a
  where a.id = p_articulo_id
  for update;
  if not found then
    raise exception 'El articulo no existe'
      using errcode = '23503';
  end if;
  if v_actual = p_estado then
    return false;
  end if;

  -- Aprobar es un acto administrativo, no una edicion mas.
  if p_estado = 'aprobado' and v_rol not in (
    'administrador'::public.app_rol,
    'coordinador'::public.app_rol
  ) then
    raise exception 'Aprobar un articulo exige rol administrador o coordinador'
      using errcode = '42501';
  end if;
  -- Escribir y proponer lo hace cualquier rol operativo; el rol consulta
  -- observa (bloque 6) pero no mueve estados.
  if v_rol = 'consulta'::public.app_rol then
    raise exception 'El rol consulta no modifica el articulado'
      using errcode = '42501';
  end if;
  if v_actual = 'descartado' and p_estado <> 'propuesto' then
    raise exception 'Un articulo descartado solo puede volver a propuesto'
      using errcode = '22023';
  end if;

  update public.norma_articulo
  set estado = p_estado,
      aprobado_por = case when p_estado = 'aprobado' then v_actor else null end,
      aprobado_en  = case when p_estado = 'aprobado' then now() else null end,
      actualizado_en = now()
  where id = p_articulo_id;

  -- El cambio de estado queda en el historial como una version sin texto nuevo:
  -- se reusa el vigente para que la traza sea una sola linea de tiempo.
  insert into public.norma_articulo_version (
    articulo_id, version, texto, sumilla, origen, autor_id, autor_rol, motivo
  )
  select
    a.id,
    (select count(*) + 1 from public.norma_articulo_version v where v.articulo_id = a.id),
    a.texto,
    a.sumilla,
    'redactado',
    v_actor,
    v_rol,
    format('%s -> %s: %s', v_actual, p_estado, btrim(p_fundamento))
  from public.norma_articulo a
  where a.id = p_articulo_id;

  return true;
end;
$$;

-- Reordenar. El `orden` es lo que manda y el `numero` se recalcula al
-- ensamblar, para que mover un articulo no obligue a renumerar a mano.
create or replace function public.reordenar_articulos(
  p_proyecto_id uuid,
  p_orden uuid[]
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rol public.app_rol;
  v_total integer;
  v_indice integer := 0;
  v_id uuid;
begin
  select a.actor_rol into v_rol from public.actor_fabrica() a;
  if v_rol is null or v_rol not in (
    'administrador'::public.app_rol,
    'coordinador'::public.app_rol
  ) then
    raise exception 'Reordenar el articulado exige rol administrador o coordinador'
      using errcode = '42501';
  end if;

  select count(*) into v_total
  from public.norma_articulo a
  where a.proyecto_id = p_proyecto_id;
  if v_total <> coalesce(array_length(p_orden, 1), 0) then
    raise exception 'El orden recibido no cubre todos los articulos del proyecto'
      using errcode = '22023';
  end if;

  -- Se aparta el orden a negativo antes de reasignar: el indice unico por
  -- (proyecto, orden) rechazaria los pasos intermedios.
  update public.norma_articulo
  set orden = -orden
  where proyecto_id = p_proyecto_id;

  foreach v_id in array p_orden loop
    v_indice := v_indice + 1;
    update public.norma_articulo
    set orden = v_indice, actualizado_en = now()
    where id = v_id and proyecto_id = p_proyecto_id;
  end loop;

  if exists (
    select 1 from public.norma_articulo a
    where a.proyecto_id = p_proyecto_id and a.orden < 0
  ) then
    raise exception 'El orden recibido no corresponde a los articulos del proyecto'
      using errcode = '22023';
  end if;

  return v_indice;
end;
$$;

revoke all on function public.guardar_articulo(uuid, text, text, text, text)
  from public, anon;
revoke all on function public.crear_articulo(uuid, text, text, text)
  from public, anon;
revoke all on function public.cambiar_estado_articulo(uuid, text, text)
  from public, anon;
revoke all on function public.reordenar_articulos(uuid, uuid[])
  from public, anon;
grant execute on function public.guardar_articulo(uuid, text, text, text, text) to authenticated;
grant execute on function public.crear_articulo(uuid, text, text, text) to authenticated;
grant execute on function public.cambiar_estado_articulo(uuid, text, text) to authenticated;
grant execute on function public.reordenar_articulos(uuid, uuid[]) to authenticated;

comment on function public.guardar_articulo(uuid, text, text, text, text) is
  'Agrega una version y actualiza el texto vigente. Nunca sobrescribe el anterior.';
comment on function public.cambiar_estado_articulo(uuid, text, text) is
  'Mueve el estado con fundamento. Aprobar exige administrador o coordinador.';

commit;
