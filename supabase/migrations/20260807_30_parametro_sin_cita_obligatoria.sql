-- ============================================================================
-- Fase 30 - Cargar un parametro deja de exigir la cita
-- ----------------------------------------------------------------------------
-- SUPERADA POR LA MIGRACION 31 (2026-08-10), que borra `norma_parametro` y
-- `confirmar_parametro`: el simulador salio del editor de articulos y dejo de
-- guardar nada. El archivo queda como registro de lo que se corrio. Si nunca la
-- aplicaste, saltala y corre directamente la 31; aplicarla despues falla con
-- 42P01 porque la tabla ya no existe.
--
-- Ejecutar despues de 20260806_29_fabrica_sin_ceremonia.sql.
--
-- La cita textual venia de la premisa del diseño original: que cada numero
-- tenia que poder defenderse ante una autoridad. Con el documento entendido
-- como la normativa nueva y no como un expediente, lo que hay del otro lado es
-- una persona cargando un maximo para ver que pasaria con los carteles
-- relevados. Pedirle que ademas copie la oracion es friccion.
--
-- El caso concreto que lo destrabo: un articulo escribe la medida en letras
-- ("seis metros cuadrados") o la deja entre corchetes, y entonces no hay
-- ninguna oracion que contenga el "6". La busqueda automatica no encuentra
-- nada, y la persona queda sin poder cargar el parametro por una regla que no
-- estaba pensando en ese caso.
--
-- La columna `cita` SIGUE existiendo y guardandose cuando la hay: la propone
-- sola la interfaz a partir del numero. Lo que se saca es la obligacion, no el
-- dato. Cuando esta, sigue diciendo de donde salio el numero.
--
-- Lo que esto cuesta, dicho claro: un parametro sin cita es un numero que
-- alguien cargo. La simulacion que sale de ahi es un insumo para decidir -ya lo
-- decia en pantalla- y no una medicion. La pantalla marca cuales tienen
-- respaldo textual y cuales no.
--
-- La firma no cambia. La migracion es idempotente.
-- ============================================================================

begin;

-- La columna nacio `not null` con la cita obligatoria. Sin esto, guardar un
-- parametro sin cita falla con 23502 y el cambio no serviria de nada.
alter table public.norma_parametro alter column cita drop not null;

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
  v_cita text;
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

  select a.texto into v_texto
  from public.norma_articulo a
  where a.id = p_articulo_id;
  if not found then
    raise exception 'El articulo no existe'
      using errcode = '23503';
  end if;

  -- La cita es opcional, pero si viene tiene que ser de verdad: una cita que no
  -- esta en el articulo es peor que ninguna, porque aparenta un respaldo que no
  -- existe. Se guarda solo si aparece textual; si no, se descarta en silencio y
  -- el parametro queda como lo que es, un numero que cargo una persona.
  v_cita := nullif(btrim(coalesce(p_cita, '')), '');
  if v_cita is not null and position(v_cita in v_texto) = 0 then
    v_cita := null;
  end if;

  insert into public.norma_parametro (
    articulo_id, clave, valor, unidad, cita, fundamento, confirmado_por, confirmado_en
  ) values (
    p_articulo_id,
    p_clave,
    p_valor,
    nullif(btrim(coalesce(p_unidad, '')), ''),
    v_cita,
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

comment on function public.confirmar_parametro(uuid, text, jsonb, text, text, text) is
  'Carga un parametro del articulo. La cita es opcional; si viene y no aparece textual en el articulo, no se guarda.';

commit;
