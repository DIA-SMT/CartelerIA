-- ============================================================================
-- Fase 25 - Un articulo nuevo nace diciendo que se pidio
-- ----------------------------------------------------------------------------
-- Ejecutar despues de 20260806_24_observaciones_articulo.sql.
--
-- `crear_articulo` grababa la primera version con el motivo fijo 'Redaccion
-- inicial', que no dice nada. Cuando el articulo lo propone el asistente a
-- partir de una idea escrita en lenguaje llano, ESE texto es el motivo: es la
-- unica forma de saber despues que pidio una persona y que escribio la maquina.
--
-- Sin esto, un articulo de origen 'asistente' queda con el texto final y sin
-- rastro de la intencion. El origen dice "lo propuso la maquina" pero no dice
-- a partir de que, y la regla del modulo es que la persona es la autora.
--
-- Se reemplaza la funcion de cuatro argumentos por una de cinco. Hay que
-- borrarla antes: `create or replace` con distinta cantidad de argumentos crea
-- una sobrecarga en vez de reemplazar, y quedarian dos versiones vivas.
--
-- La migracion es idempotente.
-- ============================================================================

begin;

drop function if exists public.crear_articulo(uuid, text, text, text);

create or replace function public.crear_articulo(
  p_proyecto_id uuid,
  p_texto text,
  p_sumilla text,
  p_origen text,
  p_motivo text
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
  -- Mismo piso que el resto del modulo: nada entra al articulado sin que
  -- alguien diga por que.
  if char_length(btrim(coalesce(p_motivo, ''))) < 12 then
    raise exception 'Crear un articulo exige decir de donde sale, con al menos 12 caracteres'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.norma_proyecto p where p.id = p_proyecto_id) then
    raise exception 'El proyecto no existe'
      using errcode = '23503';
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
    p_origen, v_actor, v_rol, btrim(p_motivo)
  );

  return v_id;
end;
$$;

revoke all on function public.crear_articulo(uuid, text, text, text, text) from public, anon;
grant execute on function public.crear_articulo(uuid, text, text, text, text) to authenticated;

comment on function public.crear_articulo(uuid, text, text, text, text) is
  'Crea un articulo nuevo. El motivo de la version 1 es lo que pidio la persona, en sus palabras.';

commit;
