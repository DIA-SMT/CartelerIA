-- ============================================================================
-- Fase 19 - Bitacora unificada y resumen del corpus para Configuracion
-- ----------------------------------------------------------------------------
-- Ejecutar despues de 20260806_18_corregir_alta_de_cuentas.sql.
--
-- Objetivos:
--   1. La pestana Auditoria necesita una sola lista ordenada por fecha sobre
--      cuatro bitacoras distintas, paginada EN LA BASE: son tablas que solo
--      crecen y traerlas enteras al navegador no escala.
--   2. La pestana Corpus necesita el estado del RAG, pero desde la migracion 13
--      `rag_documentos` esta revocada a `authenticated`. Una RPC `security
--      definer` acotada devuelve el resumen sin reabrir la tabla.
--
-- Ambas son de solo lectura y exclusivas del administrador. No crean tablas.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Bitacora unificada
-- ----------------------------------------------------------------------------
-- Une las cuatro trazas en un contrato comun. `recurso` identifica la
-- actuacion; `fundamento` es el texto que justifico la accion, que en cada
-- tabla tiene un nombre distinto (nota, fundamento, motivo).
--
-- `security definer` porque agrega `perfiles_historial` y
-- `acceso_datos_sensibles`, ambas reservadas al administrador, y porque debe
-- contar el total exacto para paginar.
create or replace function public.bitacora_unificada(
  p_tipos text[] default null,
  p_desde date default null,
  p_hasta date default null,
  p_limite integer default 50,
  p_offset integer default 0
)
returns table (
  tipo text,
  ocurrido_en timestamptz,
  actor_nombre text,
  actor_rol public.app_rol,
  accion text,
  recurso text,
  fundamento text,
  total_filas bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_desde timestamptz;
  v_hasta timestamptz;
  v_limite integer;
  v_offset integer;
  v_tipos text[];
begin
  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or not public.tiene_rol(array['administrador']::public.app_rol[]) then
    raise exception 'Solo un administrador autenticado puede leer la bitacora'
      using errcode = '42501';
  end if;

  -- Saneamiento de la entrada: la pagina se acota para que nadie pueda pedir
  -- la tabla entera cambiando un parametro.
  v_limite := least(greatest(coalesce(p_limite, 50), 1), 200);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_desde  := coalesce(p_desde, current_date - interval '3650 days')::timestamptz;
  v_hasta  := (coalesce(p_hasta, current_date) + interval '1 day')::timestamptz;

  select array_agg(t)
  into v_tipos
  from unnest(coalesce(p_tipos, array[]::text[])) as t
  where t in ('inspeccion', 'expediente', 'vinculo', 'rol', 'acceso');
  if v_tipos is null or array_length(v_tipos, 1) is null then
    v_tipos := array['inspeccion', 'expediente', 'vinculo', 'rol', 'acceso'];
  end if;

  return query
  with unificada as (
    select
      'inspeccion'::text as tipo,
      h.created_at as ocurrido_en,
      h.changed_by_nombre as actor_nombre,
      h.changed_by_rol as actor_rol,
      coalesce(h.estado_anterior, 'alta') || ' -> ' || h.estado_nuevo as accion,
      'Inspeccion ' || h.inspeccion_id::text as recurso,
      h.nota as fundamento
    from public.inspeccion_historial h
    where 'inspeccion' = any(v_tipos)

    union all
    select
      'expediente',
      h.created_at,
      h.changed_by_nombre,
      h.changed_by_rol,
      coalesce(h.estado_anterior, 'alta') || ' -> ' || h.estado_nuevo,
      'Expediente ' || h.expediente_id::text,
      h.nota
    from public.expediente_historial h
    where 'expediente' = any(v_tipos)

    union all
    select
      'vinculo',
      h.created_at,
      h.actor_nombre,
      h.actor_rol,
      h.accion,
      'Cartel ' || h.cartel_id || ' / ' || h.territorial_feature_id,
      h.fundamento
    from public.cartel_vinculo_historial h
    where 'vinculo' = any(v_tipos)

    union all
    select
      'rol',
      h.created_at,
      h.actor_nombre,
      h.actor_rol,
      coalesce(h.rol_anterior::text, 'sin rol') || ' -> ' || h.rol_nuevo::text,
      'Cuenta ' || h.user_id::text,
      h.fundamento
    from public.perfiles_historial h
    where 'rol' = any(v_tipos)

    union all
    select
      'acceso',
      a.created_at,
      p.nombre,
      a.actor_rol,
      'lectura de ' || a.recurso,
      a.recurso_id,
      a.motivo
    from public.acceso_datos_sensibles a
    left join public.perfiles p on p.user_id = a.actor_id
    where 'acceso' = any(v_tipos)
  ),
  ventana as (
    select * from unificada u
    where u.ocurrido_en >= v_desde and u.ocurrido_en < v_hasta
  )
  select
    v.tipo,
    v.ocurrido_en,
    v.actor_nombre,
    v.actor_rol,
    v.accion,
    v.recurso,
    v.fundamento,
    count(*) over () as total_filas
  from ventana v
  order by v.ocurrido_en desc
  limit v_limite
  offset v_offset;
end;
$$;

revoke all on function public.bitacora_unificada(text[], date, date, integer, integer)
  from public, anon;
grant execute on function public.bitacora_unificada(text[], date, date, integer, integer)
  to authenticated;

comment on function public.bitacora_unificada(text[], date, date, integer, integer) is
  'Bitacora unificada y paginada de actuaciones, vinculos, roles y accesos. Solo administrador.';

-- ----------------------------------------------------------------------------
-- 2. Resumen del corpus documental
-- ----------------------------------------------------------------------------
-- El corpus quedo cerrado a `authenticated` en la migracion 13 y asi debe
-- seguir: esta RPC devuelve metadatos de procedencia, nunca el contenido de
-- ningun chunk.
create or replace function public.resumen_corpus_rag()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_resultado jsonb;
begin
  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or not public.tiene_rol(array['administrador']::public.app_rol[]) then
    raise exception 'Solo un administrador autenticado puede leer el corpus'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'documentos', (select count(*) from public.rag_documentos),
    'chunks', (select count(*) from public.rag_chunks),
    'contrato_version', (
      select max(d.ingest_contract_version) from public.rag_documentos d
    ),
    'ultima_ingesta', (
      select max(d.ingestado_en) from public.rag_documentos d
    ),
    'habilitados_ia_externa', (
      select count(*) from public.rag_documentos d where d.external_ai_allowed
    ),
    'items', coalesce((
      select jsonb_agg(item order by item->>'titulo')
      from (
        select jsonb_build_object(
          'id', d.id,
          'titulo', d.titulo,
          'categoria', d.categoria,
          'paginas', d.paginas,
          'chunks', d.chunks,
          'audiencia', d.audience,
          'contrato_version', d.ingest_contract_version,
          'revisado_por_humano', d.human_reviewed,
          'ia_externa_habilitada', d.external_ai_allowed,
          'ocr_dudoso', d.ocr_doubtful,
          'hash_pdf', d.source_pdf_hash,
          'hash_texto', d.contenido_hash,
          'ingestado_en', d.ingestado_en
        ) as item
        from public.rag_documentos d
      ) as documentos
    ), '[]'::jsonb)
  )
  into v_resultado;

  return v_resultado;
end;
$$;

revoke all on function public.resumen_corpus_rag() from public, anon;
grant execute on function public.resumen_corpus_rag() to authenticated;

comment on function public.resumen_corpus_rag() is
  'Procedencia y estado del corpus RAG, sin exponer el contenido. Solo administrador.';

-- ----------------------------------------------------------------------------
-- 3. Estado verificable de los buckets de evidencia
-- ----------------------------------------------------------------------------
-- La pestana Seguridad muestra lo que se puede comprobar y lo que no, por
-- separado. Esto es de lo comprobable: sale de storage.buckets, que no es
-- legible por `authenticated`.
create or replace function public.estado_buckets_evidencia()
returns table (
  bucket text,
  publico boolean,
  limite_bytes bigint,
  mime_permitidos text[]
)
language plpgsql
stable
security definer
set search_path = public, storage
as $$
#variable_conflict use_column
begin
  if auth.uid() is null
     or coalesce(auth.role(), '') = 'service_role'
     or not public.tiene_rol(array['administrador']::public.app_rol[]) then
    raise exception 'Solo un administrador autenticado puede leer el estado de los buckets'
      using errcode = '42501';
  end if;

  return query
  select b.id, b.public, b.file_size_limit, b.allowed_mime_types
  from storage.buckets b
  where b.id in ('inspeccion-fotos', 'expediente-docs')
  order by b.id;
end;
$$;

revoke all on function public.estado_buckets_evidencia() from public, anon;
grant execute on function public.estado_buckets_evidencia() to authenticated;

comment on function public.estado_buckets_evidencia() is
  'Privacidad, limite y MIME de los buckets de evidencia. Solo administrador.';

commit;
