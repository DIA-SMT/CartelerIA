-- ============================================================================
-- Fase 23 - Parametros confirmados y diagnosticos del articulado
-- ----------------------------------------------------------------------------
-- Ejecutar despues de 20260806_22_estado_legal_efectivo.sql.
--
-- Dos registros distintos, que se verifican de manera distinta y por eso no se
-- mezclan:
--
--   norma_parametro   lo que un articulo exige, expresado como regla evaluable.
--                     Lo propone el asistente y lo CONFIRMA una persona. Sin
--                     confirmacion la simulacion no corre: falla, no supone.
--
--   norma_diagnostico hallazgos contra la norma vigente y resultados contra los
--                     carteles. Un diagnostico grave se atiende con fundamento;
--                     no se borra.
--
-- La migracion es idempotente.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Parametros evaluables de un articulo
-- ----------------------------------------------------------------------------
-- `valor` es jsonb porque un parametro puede ser un numero (superficie maxima)
-- o una lista (zonas habilitadas). `cita` es el fragmento textual del articulo
-- que sostiene el parametro, ya verificado contra el texto.
create table if not exists public.norma_parametro (
  id              uuid primary key default gen_random_uuid(),
  articulo_id     uuid not null references public.norma_articulo(id) on delete cascade,
  clave           text not null,
  valor           jsonb not null,
  unidad          text,
  cita            text not null,
  fundamento      text,
  confirmado_por  uuid references auth.users(id),
  confirmado_en   timestamptz,
  creado_en       timestamptz not null default now(),
  constraint norma_parametro_clave_check
    check (clave in (
      'superficie_maxima_m2',
      'distancia_minima_corredor_m',
      'distancia_minima_lugar_permitido_m',
      'zonas_habilitadas'
    ))
);

-- Un parametro por clave y por articulo: dos superficies maximas distintas
-- para el mismo articulo es una contradiccion, no una opcion.
create unique index if not exists norma_parametro_uidx
  on public.norma_parametro(articulo_id, clave);

comment on table public.norma_parametro is
  'Reglas evaluables de un articulo. Un parametro sin confirmar no se simula: la simulacion falla.';

-- ----------------------------------------------------------------------------
-- 2. Diagnosticos
-- ----------------------------------------------------------------------------
create table if not exists public.norma_diagnostico (
  id           uuid primary key default gen_random_uuid(),
  articulo_id  uuid not null references public.norma_articulo(id) on delete cascade,
  tipo         text not null,
  severidad    text not null default 'baja',
  descripcion  text not null,
  referencia   text,
  cita         text,
  datos        jsonb,
  generado_en  timestamptz not null default now(),
  atendido_por uuid references auth.users(id),
  atendido_en  timestamptz,
  fundamento   text,
  constraint norma_diagnostico_tipo_check
    check (tipo in ('contradiccion', 'derogacion_implicita', 'vacio', 'impacto_territorial')),
  constraint norma_diagnostico_severidad_check
    check (severidad in ('baja', 'media', 'alta'))
);

create index if not exists norma_diagnostico_articulo_idx
  on public.norma_diagnostico(articulo_id, generado_en desc);

comment on table public.norma_diagnostico is
  'Hallazgos del diagnostico. Uno grave se atiende con fundamento; nunca se borra.';

alter table public.norma_parametro   enable row level security;
alter table public.norma_diagnostico enable row level security;

drop policy if exists norma_parametro_select on public.norma_parametro;
create policy norma_parametro_select on public.norma_parametro
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector','consulta']::public.app_rol[]
    )
  );

drop policy if exists norma_diagnostico_select on public.norma_diagnostico;
create policy norma_diagnostico_select on public.norma_diagnostico
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector','consulta']::public.app_rol[]
    )
  );

revoke insert, update, delete on public.norma_parametro
  from anon, authenticated, service_role;
revoke insert, update, delete on public.norma_diagnostico
  from anon, authenticated, service_role;
revoke truncate on table public.norma_parametro, public.norma_diagnostico
  from anon, authenticated, service_role;

-- Un diagnostico no se borra: se atiende. Solo cambian las columnas de
-- atencion; el hallazgo original queda tal como se genero.
create or replace function public.proteger_diagnostico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un diagnostico no se borra: se atiende con fundamento'
      using errcode = '42501';
  end if;
  if new.tipo is distinct from old.tipo
     or new.severidad is distinct from old.severidad
     or new.descripcion is distinct from old.descripcion
     or new.cita is distinct from old.cita
     or new.datos is distinct from old.datos
     or new.generado_en is distinct from old.generado_en then
    raise exception 'El contenido de un diagnostico es inmutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_norma_diagnostico_inmutable on public.norma_diagnostico;
create trigger trg_norma_diagnostico_inmutable
  before update or delete on public.norma_diagnostico
  for each row execute function public.proteger_diagnostico();

-- ----------------------------------------------------------------------------
-- 3. Confirmar un parametro: SIEMPRE una persona
-- ----------------------------------------------------------------------------
-- El asistente propone y la propuesta viaja al navegador; no entra a esta tabla
-- por ninguna via automatica. Por eso la RPC excluye a service_role: aunque la
-- ruta quisiera guardar una propuesta, no puede.
create or replace function public.confirmar_parametro(
  p_articulo_id uuid,
  p_clave text,
  p_valor jsonb,
  p_unidad text,
  p_cita text,
  p_fundamento text
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
  v_id uuid;
  v_texto text;
begin
  select a.actor_id, a.actor_rol into v_actor, v_rol from public.actor_fabrica() a;
  if v_rol is null or v_rol not in (
    'administrador'::public.app_rol,
    'coordinador'::public.app_rol,
    'inspector'::public.app_rol
  ) then
    raise exception 'Confirmar un parametro exige un rol operativo'
      using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_cita, ''))) < 25 then
    raise exception 'El parametro necesita la cita textual del articulo que lo sostiene'
      using errcode = '22023';
  end if;

  -- La cita tiene que estar EN el articulo. Es la misma regla que se aplica a
  -- los hallazgos: sin respaldo textual verificable, no entra.
  select a.texto into v_texto
  from public.norma_articulo a
  where a.id = p_articulo_id;
  if not found then
    raise exception 'El articulo no existe'
      using errcode = '23503';
  end if;
  if position(btrim(p_cita) in v_texto) = 0 then
    raise exception 'La cita no aparece textualmente en el articulo'
      using errcode = '22023';
  end if;

  insert into public.norma_parametro (
    articulo_id, clave, valor, unidad, cita, fundamento, confirmado_por, confirmado_en
  ) values (
    p_articulo_id,
    p_clave,
    p_valor,
    nullif(btrim(coalesce(p_unidad, '')), ''),
    btrim(p_cita),
    nullif(btrim(coalesce(p_fundamento, '')), ''),
    v_actor,
    now()
  )
  on conflict (articulo_id, clave) do update
  set valor = excluded.valor,
      unidad = excluded.unidad,
      cita = excluded.cita,
      fundamento = excluded.fundamento,
      confirmado_por = excluded.confirmado_por,
      confirmado_en = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Registrar diagnosticos y atenderlos
-- ----------------------------------------------------------------------------
-- Los diagnosticos SI los escribe la ruta con service_role: son hallazgos de
-- maquina, no actos administrativos. Nacen sin atender y no habilitan nada por
-- si mismos; lo que si hacen es bloquear la exportacion para elevar hasta que
-- una persona los atienda con fundamento.
create or replace function public.registrar_diagnosticos(
  p_articulo_id uuid,
  p_diagnosticos jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_insertados integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Los diagnosticos los registra la ruta de la Fabrica'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p_diagnosticos) <> 'array' then
    raise exception 'Formato de diagnosticos invalido'
      using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_diagnosticos) loop
    insert into public.norma_diagnostico (
      articulo_id, tipo, severidad, descripcion, referencia, cita, datos
    ) values (
      p_articulo_id,
      v_item->>'tipo',
      coalesce(nullif(v_item->>'severidad', ''), 'baja'),
      coalesce(v_item->>'descripcion', ''),
      nullif(v_item->>'referencia', ''),
      nullif(v_item->>'cita', ''),
      v_item->'datos'
    );
    v_insertados := v_insertados + 1;
  end loop;

  return v_insertados;
end;
$$;

create or replace function public.atender_diagnostico(
  p_diagnostico_id uuid,
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
begin
  select a.actor_id, a.actor_rol into v_actor, v_rol from public.actor_fabrica() a;
  if v_rol is null or v_rol not in (
    'administrador'::public.app_rol,
    'coordinador'::public.app_rol
  ) then
    raise exception 'Atender un diagnostico exige rol administrador o coordinador'
      using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_fundamento, ''))) < 12 then
    raise exception 'Atender un diagnostico exige un fundamento de al menos 12 caracteres'
      using errcode = '22023';
  end if;

  update public.norma_diagnostico
  set atendido_por = v_actor,
      atendido_en = now(),
      fundamento = btrim(p_fundamento)
  where id = p_diagnostico_id
    and atendido_en is null;

  return found;
end;
$$;

revoke all on function public.confirmar_parametro(uuid, text, jsonb, text, text, text)
  from public, anon;
revoke all on function public.registrar_diagnosticos(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.atender_diagnostico(uuid, text)
  from public, anon;
grant execute on function public.confirmar_parametro(uuid, text, jsonb, text, text, text) to authenticated;
grant execute on function public.registrar_diagnosticos(uuid, jsonb) to service_role;
grant execute on function public.atender_diagnostico(uuid, text) to authenticated;

comment on function public.confirmar_parametro(uuid, text, jsonb, text, text, text) is
  'Confirma un parametro evaluable. Exige persona y cita verificable en el articulo.';

-- ----------------------------------------------------------------------------
-- 5. Cuota propia para la Fabrica
-- ----------------------------------------------------------------------------
-- Scope separado del de normativa a proposito: si compartieran cuota, redactar
-- articulos dejaria sin consultas al asistente normativo.
alter table public.api_cuotas drop constraint if exists api_cuotas_scope_check;
alter table public.api_cuotas add constraint api_cuotas_scope_check
  check (scope in ('normativa', 'evidencia', 'fabrica'));

create or replace function public.consumir_cuota_fabrica(
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
  v_limite integer := 12;
  v_inicio timestamptz;
  v_cantidad integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'La cuota de la Fabrica solo la consume la ruta autorizada'
      using errcode = '42501';
  end if;
  if p_actor_id is null then
    raise exception 'La cuota exige un actor identificado'
      using errcode = '22023';
  end if;

  insert into public.api_cuotas as cuota (actor_id, scope, ventana_inicio, cantidad, updated_at)
  values (p_actor_id, 'fabrica', v_now, 1, v_now)
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
    else greatest(1, ceil(extract(epoch from ((v_inicio + v_ventana) - v_now)))::integer)
  end;
  return next;
end;
$$;

revoke all on function public.consumir_cuota_fabrica(uuid)
  from public, anon, authenticated;
grant execute on function public.consumir_cuota_fabrica(uuid) to service_role;

commit;
