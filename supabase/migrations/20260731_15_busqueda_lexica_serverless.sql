-- ============================================================================
-- Recuperación documental apta para serverless.
-- ----------------------------------------------------------------------------
-- La consulta interactiva usa full-text search dentro de PostgreSQL y evita
-- descargar un modelo de embeddings pesado en cada instancia efímera. Los
-- embeddings existentes se conservan para procesos offline o una futura
-- infraestructura con caché persistente.
-- ============================================================================

begin;

create or replace function public.normalizar_texto_rag(p_texto text)
returns text
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
  select translate(lower(p_texto), 'áéíóúü', 'aeiouu');
$$;

revoke all on function public.normalizar_texto_rag(text)
  from public, anon, authenticated;
grant execute on function public.normalizar_texto_rag(text)
  to service_role;

alter table public.rag_chunks
  add column if not exists busqueda_lexica tsvector
  generated always as (
    setweight(
      to_tsvector(
        'spanish'::regconfig,
        public.normalizar_texto_rag(coalesce(seccion, ''))
      ),
      'A'
    )
    || setweight(
      to_tsvector(
        'spanish'::regconfig,
        public.normalizar_texto_rag(contenido)
      ),
      'B'
    )
  ) stored;

alter table public.rag_documentos
  add column if not exists busqueda_lexica tsvector
  generated always as (
    setweight(
      to_tsvector(
        'spanish'::regconfig,
        public.normalizar_texto_rag(titulo)
      ),
      'A'
    )
  ) stored;

drop index if exists public.rag_chunks_contenido_fts_idx;

create index if not exists rag_chunks_busqueda_lexica_idx
  on public.rag_chunks using gin (
    busqueda_lexica
  );

drop index if exists public.rag_documentos_busqueda_lexica_idx;

drop function if exists public.buscar_rag_chunks_lexico(text, integer);

create function public.buscar_rag_chunks_lexico(
  p_query text,
  p_match_count integer default 8
)
returns table (
  id uuid,
  documento_id text,
  titulo text,
  pdf_url text,
  pagina integer,
  seccion text,
  contenido text,
  similarity double precision,
  contenido_hash text,
  source_pdf_hash text,
  ingest_contract_version integer,
  human_reviewed boolean,
  external_ai_allowed boolean,
  audience text,
  ocr_doubtful boolean
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with entrada as (
    select
      public.normalizar_texto_rag(
        left(btrim(coalesce(p_query, '')), 500)
      ) as texto,
      least(greatest(coalesce(p_match_count, 8), 1), 8) as max_rows
  ),
  lexemas as (
    select
      e.texto,
      e.max_rows,
      array(
        select distinct termino.lexema
        from unnest(
          tsvector_to_array(
            to_tsvector('spanish'::regconfig, e.texto)
          )
        ) as termino(lexema)
        where length(termino.lexema) >= 1
        order by termino.lexema
      ) as terminos
    from entrada e
  ),
  consulta as (
    select
      l.texto,
      l.max_rows,
      l.terminos,
      case
        when cardinality(l.terminos) > 0 then (
          select string_agg(
            quote_literal(termino.lexema),
            ' | '
            order by termino.lexema
          )::tsquery
          from unnest(l.terminos) as termino(lexema)
        )
        else null::tsquery
      end as consulta_or
    from lexemas l
  ),
  candidatos as (
    select
      c.id,
      c.documento_id,
      d.titulo,
      d.pdf_url,
      c.pagina,
      c.seccion,
      c.contenido,
      (
        0.8 * cobertura_total.coincidencias::double precision
          / cardinality(e.terminos)::double precision
        + 0.2 * ts_rank_cd(
          c.busqueda_lexica || d.busqueda_lexica,
          e.consulta_or,
          32
        )::double precision
      ) as relevancia,
      d.contenido_hash,
      d.source_pdf_hash,
      d.ingest_contract_version,
      d.human_reviewed,
      d.external_ai_allowed,
      d.audience,
      d.ocr_doubtful,
      c.orden
    from public.rag_chunks c
    join public.rag_documentos d
      on d.id = c.documento_id
    cross join consulta e
    cross join lateral (
      select count(*)::integer as coincidencias
      from unnest(e.terminos) as termino(lexema)
      where termino.lexema = any(tsvector_to_array(c.busqueda_lexica))
    ) cobertura_chunk
    cross join lateral (
      select count(*)::integer as coincidencias
      from unnest(e.terminos) as termino(lexema)
      where termino.lexema = any(
        tsvector_to_array(c.busqueda_lexica || d.busqueda_lexica)
      )
    ) cobertura_total
    where length(e.texto) >= 2
      and e.consulta_or is not null
      and c.busqueda_lexica @@ e.consulta_or
      and cobertura_chunk.coincidencias >= 1
      and cobertura_total.coincidencias >= greatest(
        least(2, cardinality(e.terminos)),
        ceil(cardinality(e.terminos) * 0.4)::integer
      )
  )
  select
    c.id,
    c.documento_id,
    c.titulo,
    c.pdf_url,
    c.pagina,
    c.seccion,
    c.contenido,
    least(1.0, greatest(0.0, c.relevancia)) as similarity,
    c.contenido_hash,
    c.source_pdf_hash,
    c.ingest_contract_version,
    c.human_reviewed,
    c.external_ai_allowed,
    c.audience,
    c.ocr_doubtful
  from candidatos c
  where c.relevancia >= 0.30
  order by
    c.relevancia desc,
    c.documento_id,
    c.orden,
    c.id
  limit (select max_rows from consulta);
$$;

revoke all on function public.buscar_rag_chunks_lexico(text, integer)
  from public, anon, authenticated;
grant execute on function public.buscar_rag_chunks_lexico(text, integer)
  to service_role;

comment on function public.buscar_rag_chunks_lexico(text, integer) is
  'Recuperación fts-spanish-v1 privada y server-side; cobertura mínima, coincidencia obligatoria en el chunk y metadatos de trazabilidad.';

commit;
