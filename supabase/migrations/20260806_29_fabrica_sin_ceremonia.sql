-- ============================================================================
-- Fase 29 - La Fabrica deja de pedir permiso
-- ----------------------------------------------------------------------------
-- Ejecutar despues de 20260806_28_ocr_dudoso_revisado.sql.
--
-- El modulo se construyo sobre una premisa equivocada: que el documento
-- recibido era un borrador a revisar y aprobar articulo por articulo. No lo es
-- -es la normativa nueva, y esta bien-, asi que todo el aparato de fundamentos
-- obligatorios sobraba. Guardar un articulo no es un acto administrativo.
--
-- Se relajan los tres RPC que exigian texto para dejarte trabajar. Las firmas
-- NO cambian, asi que no hay sobrecargas que borrar ni ventana de PGRST202.
--
-- Lo que NO cambia, porque no cuesta un solo clic:
--   - cada guardado sigue agregando una version con fecha y autor;
--   - `texto_original` del documento recibido sigue siendo inmutable por trigger;
--   - nadie sobrescribe: sigue sin haber update directo sobre el texto.
--
-- El motivo pasa a ser opcional, no desaparece. Cuando hay algo que decir -por
-- ejemplo la idea en lenguaje llano que se le dio al asistente- se guarda igual,
-- y ahi si vale la pena.
--
-- La migracion es idempotente.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Guardar: versiona igual, sin pedir explicaciones
-- ----------------------------------------------------------------------------
-- Cambios respecto de la migracion 21: se va la exigencia de motivo desde el
-- segundo guardado, y se van los dos bloqueos por estado (aprobado y
-- descartado). Ya no hay estados que defender: un articulo se edita y listo.
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

  perform 1 from public.norma_articulo a where a.id = p_articulo_id for update;
  if not found then
    raise exception 'El articulo no existe'
      using errcode = '23503';
  end if;

  select count(*) into v_versiones
  from public.norma_articulo_version v
  where v.articulo_id = p_articulo_id;
  v_siguiente := v_versiones + 1;

  -- Nada se sobrescribe: se agrega una version y el texto vigente pasa a ser el
  -- nuevo. El anterior queda en el historial, con o sin motivo.
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

-- ----------------------------------------------------------------------------
-- Crear: el motivo vuelve a ser opcional
-- ----------------------------------------------------------------------------
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
  -- Un articulo nuevo nunca puede declararse como recibido en el documento
  -- original: eso lo volveria intocable por el trigger de `texto_original`.
  if p_origen not in ('redactado', 'asistente') then
    raise exception 'Un articulo nuevo no puede declararse como recibido en el borrador'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.norma_proyecto p where p.id = p_proyecto_id) then
    raise exception 'El proyecto no existe' using errcode = '23503';
  end if;

  select coalesce(max(a.orden), 0) + 1 into v_orden
  from public.norma_articulo a
  where a.proyecto_id = p_proyecto_id;

  insert into public.norma_articulo (
    proyecto_id, orden, sumilla, texto, estado, origen, autor_id
  ) values (
    p_proyecto_id, v_orden,
    nullif(btrim(coalesce(p_sumilla, '')), ''),
    btrim(p_texto), 'propuesto', p_origen, v_actor
  )
  returning id into v_id;

  -- Cuando el articulo sale del lienzo, el motivo es la idea en lenguaje llano
  -- que escribio la persona: ahi si vale la pena guardarlo. Cuando no hay,
  -- queda en null y no se inventa una frase de relleno.
  insert into public.norma_articulo_version (
    articulo_id, version, texto, sumilla, origen, autor_id, autor_rol, motivo
  ) values (
    v_id, 1, btrim(p_texto),
    nullif(btrim(coalesce(p_sumilla, '')), ''),
    p_origen, v_actor, v_rol,
    nullif(btrim(coalesce(p_motivo, '')), '')
  );

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Quitar del documento y volver a incluirlo, sin fundamento
-- ----------------------------------------------------------------------------
-- La interfaz ya no muestra los cuatro estados: solo usa 'descartado' para
-- sacar un articulo del documento y 'propuesto' para volver a meterlo. La
-- columna se conserva porque es el mecanismo, no una etiqueta que alguien lea.
-- Se va la exigencia de fundamento y se va el requisito de rol para aprobar,
-- que ya no tiene a quien aplicarse.
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
  if v_rol is null or v_rol not in (
    'administrador'::public.app_rol,
    'coordinador'::public.app_rol,
    'inspector'::public.app_rol
  ) then
    raise exception 'Escribir el articulado exige un rol operativo'
      using errcode = '42501';
  end if;
  if p_estado not in ('propuesto', 'en_revision', 'aprobado', 'descartado') then
    raise exception 'Estado de articulo no reconocido'
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

  update public.norma_articulo
  set estado = p_estado,
      aprobado_por = case when p_estado = 'aprobado' then v_actor else null end,
      aprobado_en  = case when p_estado = 'aprobado' then now() else null end,
      actualizado_en = now()
  where id = p_articulo_id;

  -- Queda en el historial como una version sin texto nuevo: la traza sigue
  -- siendo una sola linea de tiempo.
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
    case
      when char_length(btrim(coalesce(p_fundamento, ''))) > 0
        then format('%s -> %s: %s', v_actual, p_estado, btrim(p_fundamento))
      else format('%s -> %s', v_actual, p_estado)
    end
  from public.norma_articulo a
  where a.id = p_articulo_id;

  return true;
end;
$$;

commit;
