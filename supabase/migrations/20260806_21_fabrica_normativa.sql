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
create table if not exists public.norma_articulo_version (
  id          uuid primary key default gen_random_uuid(),
  articulo_id uuid not null references public.norma_articulo(id) on delete cascade,
  version     integer not null,
  texto       text not null,
  sumilla     text,
  autor_id    uuid references auth.users(id),
  autor_rol   public.app_rol,
  motivo      text,
  creado_en   timestamptz not null default now()
);

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
      motivo
    ) values (
      v_articulo_id,
      1,
      coalesce(v_item->>'texto', ''),
      nullif(btrim(coalesce(v_item->>'sumilla', '')), ''),
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

commit;
