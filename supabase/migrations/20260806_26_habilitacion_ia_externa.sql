-- ============================================================================
-- Fase 26 - Habilitar un documento para IA externa es un acto, no una bandera
-- ----------------------------------------------------------------------------
-- Ejecutar despues de 20260806_25_articulo_nuevo_con_motivo.sql.
--
-- Que un documento municipal salga hacia un proveedor externo es una decision
-- con consecuencias. Hasta ahora las banderas `human_reviewed` y
-- `external_ai_allowed` solo se podian tocar con un update a mano en el SQL
-- Editor: sin autor, sin fundamento y sin rastro.
--
-- Ahora se cambian por RPC, con las mismas reglas que el resto del sistema:
-- administrador humano, fundamento obligatorio y registro inmutable en
-- `auditoria_eventos`. `service_role` queda excluido a proposito: es una
-- identidad tecnica y esto es una autorizacion.
--
-- Dos barreras que no dependen de quien llame:
--   - un documento `interno` NUNCA sale, aunque alguien lo pida;
--   - un documento en estado `proyecto` tampoco, asi el borrador de la
--     ordenanza no puede habilitarse ni por error.
--
-- Apagar siempre se puede, sin esas barreras: dejar de mandar algo afuera no
-- necesita autorizacion, necesita rapidez.
--
-- La migracion es idempotente.
-- ============================================================================

begin;

create or replace function public.habilitar_documento_ia_externa(
  p_documento_id text,
  p_revisado boolean,
  p_ia_externa boolean,
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
  v_nombre text;
  v_anterior public.rag_documentos%rowtype;
begin
  v_actor := auth.uid();
  if v_actor is null or coalesce(auth.role(), '') = 'service_role' then
    raise exception 'Habilitar un documento para IA externa exige una persona autenticada'
      using errcode = '42501';
  end if;

  select p.rol, p.nombre into v_rol, v_nombre
  from public.perfiles p where p.user_id = v_actor;

  if v_rol is distinct from 'administrador'::public.app_rol then
    raise exception 'Solo un administrador decide que documentos salen del municipio'
      using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_fundamento, ''))) < 12 then
    raise exception 'La decision exige un fundamento de al menos 12 caracteres'
      using errcode = '22023';
  end if;

  select * into v_anterior from public.rag_documentos d where d.id = p_documento_id;
  if v_anterior.id is null then
    raise exception 'El documento no existe' using errcode = '23503';
  end if;

  -- Barreras solo al habilitar. Apagar es siempre legitimo.
  if p_ia_externa then
    if v_anterior.audience is distinct from 'publico' then
      raise exception 'Un documento interno no sale del municipio'
        using errcode = '42501';
    end if;
    if v_anterior.estado_legal is distinct from 'vigente' then
      raise exception 'Solo un documento vigente sale del municipio: un proyecto sin sancionar, nunca'
        using errcode = '42501';
    end if;
    if not p_revisado then
      raise exception 'Un documento sin revision humana no se habilita para IA externa'
        using errcode = '22023';
    end if;
  end if;

  update public.rag_documentos
  set human_reviewed = p_revisado,
      external_ai_allowed = p_ia_externa
  where id = p_documento_id;

  -- El fundamento va al lado del antes y el despues: sin el, el registro dice
  -- que cambio pero no por que, que es la mitad que no sirve.
  insert into public.auditoria_eventos (
    entidad, entidad_id, accion, datos_anteriores, datos_nuevos,
    actor_id, actor_nombre, actor_rol
  ) values (
    'rag_documentos',
    p_documento_id,
    'update',
    jsonb_build_object(
      'human_reviewed', v_anterior.human_reviewed,
      'external_ai_allowed', v_anterior.external_ai_allowed
    ),
    jsonb_build_object(
      'human_reviewed', p_revisado,
      'external_ai_allowed', p_ia_externa,
      'fundamento', btrim(p_fundamento)
    ),
    v_actor,
    v_nombre,
    v_rol
  );

  return true;
end;
$$;

revoke all on function public.habilitar_documento_ia_externa(text, boolean, boolean, text)
  from public, anon, service_role;
grant execute on function public.habilitar_documento_ia_externa(text, boolean, boolean, text)
  to authenticated;

comment on function public.habilitar_documento_ia_externa(text, boolean, boolean, text) is
  'Marca un documento como revisado y/o habilitado para IA externa. Administrador humano, con fundamento, auditado.';

-- ----------------------------------------------------------------------------
-- Lectura del texto indexado, para poder revisarlo antes de habilitarlo
-- ----------------------------------------------------------------------------
-- Marcar como revisado sin haber leido seria firmar en falso. Esta funcion es
-- lo que hace posible leer: devuelve los fragmentos tal como estan indexados,
-- que es exactamente lo que veria el modelo.
drop function if exists public.fragmentos_documento(text);
create or replace function public.fragmentos_documento(p_documento_id text)
returns table (
  id uuid,
  seccion text,
  pagina integer,
  contenido text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.tiene_rol(array['administrador']::public.app_rol[]) then
    raise exception 'Solo un administrador lee el corpus indexado'
      using errcode = '42501';
  end if;

  -- En el orden en que quedaron indexados: es como los lee el modelo y como
  -- vienen en el documento.
  return query
  select c.id, c.seccion, c.pagina, c.contenido
  from public.rag_chunks c
  where c.documento_id = p_documento_id
  order by c.orden, c.pagina nulls last;
end;
$$;

revoke all on function public.fragmentos_documento(text) from public, anon;
grant execute on function public.fragmentos_documento(text) to authenticated;

commit;
