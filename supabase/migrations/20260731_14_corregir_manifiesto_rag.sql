-- ============================================================================
-- Fase 14 - Correccion de precedencia en el manifiesto canonico RAG
-- ----------------------------------------------------------------------------
-- Ejecutar despues de 20260729_13_integridad_legal.sql.
--
-- La expresion final del string_agg debe parentizar el operador JSON ->>.
-- Sin los parentesis, PostgreSQL intenta aplicar ->> al texto ya concatenado
-- y aborta la ingesta con SQLSTATE 42883. CREATE OR REPLACE conserva la firma
-- y vuelve a declarar los permisos de forma fail-closed.
-- ============================================================================

begin;

create or replace function public.sincronizar_documento_rag(
  p_documento jsonb,
  p_chunks jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id text := nullif(btrim(coalesce(p_documento->>'id', '')), '');
  v_titulo text := nullif(btrim(coalesce(p_documento->>'titulo', '')), '');
  v_categoria text := nullif(btrim(coalesce(p_documento->>'categoria', '')), '');
  v_pdf_url text := nullif(btrim(coalesce(p_documento->>'pdf_url', '')), '');
  v_contenido_hash text := lower(btrim(coalesce(p_documento->>'contenido_hash', '')));
  v_source_pdf_hash text := lower(btrim(coalesce(p_documento->>'source_pdf_hash', '')));
  v_audience text := lower(btrim(coalesce(p_documento->>'audience', 'interno')));
  v_paginas integer;
  v_chunks integer;
  v_ingest_contract_version integer;
  v_ocr_confidence numeric(5,2);
  v_ocr_doubtful boolean;
  v_existing public.rag_documentos%rowtype;
  v_had_existing boolean := false;
  v_preserve_review boolean := false;
  v_actual_chunks integer;
  v_canonical_manifest text;
  v_computed_hash text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'La ingesta RAG requiere el proceso tecnico autorizado'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p_documento) <> 'object' then
    raise exception 'Metadata RAG invalida';
  end if;
  if v_id is null
     or v_titulo is null
     or v_categoria is null
     or v_pdf_url is null then
    raise exception 'La metadata documental obligatoria esta incompleta';
  end if;
  if v_contenido_hash !~ '^[0-9a-f]{64}$'
     or v_source_pdf_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Las huellas documentales deben ser SHA-256 validos';
  end if;
  if v_audience not in ('publico', 'interno') then
    raise exception 'Audiencia documental invalida';
  end if;

  begin
    v_paginas := (p_documento->>'paginas')::integer;
    v_chunks := (p_documento->>'chunks')::integer;
    v_ingest_contract_version :=
      (p_documento->>'ingest_contract_version')::integer;
    v_ocr_doubtful := (p_documento->>'ocr_doubtful')::boolean;
    if p_documento->>'ocr_confidence' is not null then
      v_ocr_confidence := (p_documento->>'ocr_confidence')::numeric(5,2);
    end if;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Metadata numerica o booleana invalida';
  end;

  if v_paginas is null or v_paginas <= 0
     or v_chunks is null or v_chunks <= 0 or v_chunks > 5000
     or v_ingest_contract_version is distinct from 1
     or v_ocr_doubtful is null
     or (
       v_ocr_confidence is not null
       and (v_ocr_confidence < 0 or v_ocr_confidence > 100)
     ) then
    raise exception 'Conteos o metadata OCR fuera de rango';
  end if;

  select d.*
  into v_existing
  from public.rag_documentos d
  where d.id = v_id
  for update;
  v_had_existing := found;
  v_preserve_review :=
    p_chunks is null
    and v_had_existing
    and v_existing.ingest_contract_version = 1
    and v_existing.contenido_hash is not distinct from v_contenido_hash
    and v_existing.source_pdf_hash is not distinct from v_source_pdf_hash
    and v_existing.audience is not distinct from v_audience
    and v_existing.paginas is not distinct from v_paginas
    and v_existing.chunks is not distinct from v_chunks
    and v_existing.ocr_confidence is not distinct from v_ocr_confidence
    and v_existing.ocr_doubtful is not distinct from v_ocr_doubtful;

  if p_chunks is null then
    if not v_had_existing
       or v_existing.ingest_contract_version <> 1
       or v_existing.contenido_hash is distinct from v_contenido_hash
       or v_existing.source_pdf_hash is distinct from v_source_pdf_hash
       or v_existing.paginas is distinct from v_paginas
       or v_existing.chunks is distinct from v_chunks then
      raise exception 'Una version documental nueva requiere todos sus chunks';
    end if;
  else
    if jsonb_typeof(p_chunks) <> 'array'
       or jsonb_array_length(p_chunks) <> v_chunks then
      raise exception 'El lote de chunks no coincide con el catalogo';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_chunks) as items(item)
      where jsonb_typeof(item) <> 'object'
         or coalesce(item->>'pagina', '') !~ '^[0-9]+$'
         or coalesce(item->>'orden', '') !~ '^[0-9]+$'
         or nullif(btrim(coalesce(item->>'contenido', '')), '') is null
         or coalesce(item->>'seccion', '')
              is distinct from btrim(coalesce(item->>'seccion', ''))
         or case
              when jsonb_typeof(item->'embedding') = 'array'
                then jsonb_array_length(item->'embedding') <> 384
              else true
            end
    ) then
      raise exception 'El lote contiene un chunk invalido';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_chunks) as items(item)
      where (item->>'pagina')::integer < 1
         or (item->>'pagina')::integer > v_paginas
    ) then
      raise exception 'Un chunk referencia una pagina inexistente';
    end if;
    if not exists (
      select 1
      from (
        select
          count(distinct (item->>'orden')::integer) as ordenes,
          min((item->>'orden')::integer) as orden_minimo,
          max((item->>'orden')::integer) as orden_maximo
        from jsonb_array_elements(p_chunks) as items(item)
      ) as lote
      where lote.ordenes = v_chunks
        and lote.orden_minimo = 0
        and lote.orden_maximo = v_chunks - 1
    ) then
      raise exception 'Los ordenes de chunks deben ser unicos y contiguos desde cero';
    end if;

    select string_agg(
      (item->>'orden')::integer::text
        || ':' || (item->>'pagina')::integer::text
        || ':' || octet_length(coalesce(item->>'seccion', ''))::text
        || ':' || coalesce(item->>'seccion', '')
        || ':' || octet_length(item->>'contenido')::text
        || ':' || (item->>'contenido'),
      E'\n'
      order by (item->>'orden')::integer
    )
    into v_canonical_manifest
    from jsonb_array_elements(p_chunks) as items(item);

    v_computed_hash := encode(
      digest(convert_to(v_canonical_manifest, 'UTF8'), 'sha256'),
      'hex'
    );
    if v_computed_hash is distinct from v_contenido_hash then
      raise exception 'La huella del contenido no coincide con el lote de chunks';
    end if;
  end if;

  insert into public.rag_documentos as actual (
    id,
    titulo,
    categoria,
    pdf_url,
    contenido_hash,
    source_pdf_hash,
    ingest_contract_version,
    paginas,
    chunks,
    audience,
    human_reviewed,
    external_ai_allowed,
    ocr_confidence,
    ocr_doubtful,
    ingestado_en
  ) values (
    v_id,
    v_titulo,
    v_categoria,
    v_pdf_url,
    v_contenido_hash,
    v_source_pdf_hash,
    v_ingest_contract_version,
    v_paginas,
    v_chunks,
    v_audience,
    false,
    false,
    v_ocr_confidence,
    v_ocr_doubtful,
    now()
  )
  on conflict (id) do update
  set titulo = excluded.titulo,
      categoria = excluded.categoria,
      pdf_url = excluded.pdf_url,
      contenido_hash = excluded.contenido_hash,
      source_pdf_hash = excluded.source_pdf_hash,
      ingest_contract_version = excluded.ingest_contract_version,
      paginas = excluded.paginas,
      chunks = excluded.chunks,
      audience = excluded.audience,
      human_reviewed = case
        when v_preserve_review then actual.human_reviewed
        else false
      end,
      external_ai_allowed = case
        when v_preserve_review
             and excluded.audience = 'publico'
             and not excluded.ocr_doubtful
          then actual.external_ai_allowed
        else false
      end,
      ocr_confidence = excluded.ocr_confidence,
      ocr_doubtful = excluded.ocr_doubtful,
      ingestado_en = now();

  if p_chunks is not null then
    delete from public.rag_chunks c
    where c.documento_id = v_id;

    insert into public.rag_chunks (
      documento_id,
      pagina,
      seccion,
      contenido,
      orden,
      embedding
    )
    select
      v_id,
      (item->>'pagina')::integer,
      nullif(btrim(coalesce(item->>'seccion', '')), ''),
      item->>'contenido',
      (item->>'orden')::integer,
      (item->'embedding')::text::vector(384)
    from jsonb_array_elements(p_chunks) as items(item);
  end if;

  select count(*)
  into v_actual_chunks
  from public.rag_chunks c
  where c.documento_id = v_id;
  if v_actual_chunks <> v_chunks then
    raise exception 'La cantidad real de chunks no coincide con el catalogo';
  end if;

  return true;
end;
$$;

revoke all on function public.sincronizar_documento_rag(jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.sincronizar_documento_rag(jsonb, jsonb)
  to service_role;

comment on function public.sincronizar_documento_rag(jsonb, jsonb) is
  'Sincroniza metadata y chunks en una transaccion y valida su manifiesto SHA-256 canonico.';

commit;
