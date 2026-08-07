-- ============================================================================
-- Fase 24 - Observaciones de las areas por articulo
-- ----------------------------------------------------------------------------
-- Ejecutar despues de 20260806_23_diagnostico_normativo.sql.
--
-- Cualquier perfil municipal reconocido escribe su observacion, incluido el rol
-- `consulta`: es justamente el que representa a las areas que opinan sobre el
-- proyecto sin redactarlo.
--
-- Nadie edita ni borra la observacion de otro, y las propias tampoco se editan:
-- se agrega una nueva. Es el mismo criterio que el resto de la bitacora, y por
-- la misma razon: una opinion que se puede reescribir despues no sirve como
-- antecedente de nada.
--
-- La migracion es idempotente.
-- ============================================================================

begin;

create table if not exists public.norma_observacion (
  id           uuid primary key default gen_random_uuid(),
  articulo_id  uuid not null references public.norma_articulo(id) on delete cascade,
  texto        text not null,
  autor_id     uuid references auth.users(id),
  autor_nombre text,
  autor_rol    public.app_rol,
  creado_en    timestamptz not null default now(),
  atendido_por uuid references auth.users(id),
  atendido_en  timestamptz,
  fundamento   text
);

create index if not exists norma_observacion_articulo_idx
  on public.norma_observacion(articulo_id, creado_en desc);

comment on table public.norma_observacion is
  'Observaciones de las areas por articulo. Insert-only: una observacion no se edita, se agrega otra.';

alter table public.norma_observacion enable row level security;

drop policy if exists norma_observacion_select on public.norma_observacion;
create policy norma_observacion_select on public.norma_observacion
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector','consulta']::public.app_rol[]
    )
  );

revoke insert, update, delete on public.norma_observacion
  from anon, authenticated, service_role;
revoke truncate on table public.norma_observacion
  from anon, authenticated, service_role;

-- El texto de una observacion es inmutable. Lo unico que cambia son las
-- columnas de atencion, y solo del `null` inicial a un valor: reabrirla
-- borraria el rastro de que ya se habia atendido.
create or replace function public.proteger_observacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Una observacion no se borra: queda como antecedente'
      using errcode = '42501';
  end if;
  if new.texto is distinct from old.texto
     or new.autor_id is distinct from old.autor_id
     or new.autor_nombre is distinct from old.autor_nombre
     or new.autor_rol is distinct from old.autor_rol
     or new.creado_en is distinct from old.creado_en then
    raise exception 'El texto y la autoria de una observacion son inmutables'
      using errcode = '42501';
  end if;
  if old.atendido_en is not null then
    raise exception 'Una observacion ya atendida no se modifica'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_norma_observacion_inmutable on public.norma_observacion;
create trigger trg_norma_observacion_inmutable
  before update or delete on public.norma_observacion
  for each row execute function public.proteger_observacion();

-- ----------------------------------------------------------------------------
-- Escritura: solo por RPC, y solo la propia
-- ----------------------------------------------------------------------------
-- El rol `consulta` entra acá a proposito: es el unico lugar del sistema donde
-- puede escribir, y escribe una opinion, no un acto administrativo.
create or replace function public.crear_observacion(
  p_articulo_id uuid,
  p_texto text
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
  v_nombre text;
  v_id uuid;
begin
  select a.actor_id, a.actor_rol into v_actor, v_rol from public.actor_fabrica() a;
  if v_rol is null then
    raise exception 'La cuenta no tiene perfil municipal habilitado'
      using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_texto, ''))) < 10 then
    raise exception 'La observacion es demasiado corta'
      using errcode = '22023';
  end if;

  select p.nombre into v_nombre
  from public.perfiles p
  where p.user_id = v_actor;

  insert into public.norma_observacion (articulo_id, texto, autor_id, autor_nombre, autor_rol)
  values (p_articulo_id, btrim(p_texto), v_actor, v_nombre, v_rol)
  returning id into v_id;

  return v_id;
end;
$$;

-- Atender no borra el texto original: lo acompana con el fundamento.
create or replace function public.atender_observacion(
  p_observacion_id uuid,
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
  if v_rol is distinct from 'administrador'::public.app_rol then
    raise exception 'Solo un administrador marca una observacion como atendida'
      using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_fundamento, ''))) < 12 then
    raise exception 'Atender una observacion exige un fundamento de al menos 12 caracteres'
      using errcode = '22023';
  end if;

  update public.norma_observacion
  set atendido_por = v_actor,
      atendido_en = now(),
      fundamento = btrim(p_fundamento)
  where id = p_observacion_id
    and atendido_en is null;

  return found;
end;
$$;

revoke all on function public.crear_observacion(uuid, text) from public, anon;
revoke all on function public.atender_observacion(uuid, text) from public, anon;
grant execute on function public.crear_observacion(uuid, text) to authenticated;
grant execute on function public.atender_observacion(uuid, text) to authenticated;

comment on function public.crear_observacion(uuid, text) is
  'Agrega una observacion. Cualquier perfil reconocido, incluido consulta. No se edita: se agrega otra.';

commit;
