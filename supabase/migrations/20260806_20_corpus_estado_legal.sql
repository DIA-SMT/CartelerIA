-- ============================================================================
-- Fase 20 - Corpus separado por estado legal
-- ----------------------------------------------------------------------------
-- Ejecutar despues de 20260806_19_bitacora_y_corpus.sql.
--
-- Nota de numeracion: el prompt de la Fabrica Normativa pedia la migracion 17,
-- pero ese numero ya lo ocupa 20260806_17_indicadores_gestion.sql.
--
-- Esta migracion se separo de la 21 a proposito: cierra un riesgo que existe
-- HOY y conviene aplicar sin esperar al resto del paquete. Con el borrador de
-- la nueva ordenanza dentro del corpus, el asistente normativo podria
-- contestarle a un agente municipal citando un texto que todavia no se
-- sanciono. La 21 trae el articulado en construccion y puede esperar.
--
-- Objetivo: cada documento declara su estado legal (vigente, derogada,
-- proyecto) y la busqueda lexica exige saber cual se quiere.
--
-- La migracion es idempotente. No modifica el contenido de los 15 documentos
-- ya ingeridos: solo los marca como vigentes.
-- ============================================================================

begin;
-- ----------------------------------------------------------------------------
-- 1. Estado legal de cada documento del corpus
-- ----------------------------------------------------------------------------
alter table public.rag_documentos
  add column if not exists estado_legal text not null default 'vigente';

-- Los 15 documentos ya ingeridos son normativa y antecedentes vigentes. Se
-- explicita en vez de confiar en el default, para que quede en la traza.
update public.rag_documentos
set estado_legal = 'vigente'
where estado_legal is null
   or estado_legal not in ('vigente', 'derogada', 'proyecto');

alter table public.rag_documentos
  drop constraint if exists rag_documentos_estado_legal_check;
alter table public.rag_documentos
  add constraint rag_documentos_estado_legal_check
  check (estado_legal in ('vigente', 'derogada', 'proyecto'));

create index if not exists rag_documentos_estado_legal_idx
  on public.rag_documentos(estado_legal);

comment on column public.rag_documentos.estado_legal is
  'vigente | derogada | proyecto. El asistente normativo solo recupera vigente.';

-- ----------------------------------------------------------------------------
-- 2. La busqueda lexica exige declarar el estado legal
-- ----------------------------------------------------------------------------
-- Sin valor por omision permisivo: si quien llama no dice que estado quiere, la
-- funcion falla. Un default 'vigente' seria comodo y peligroso, porque el dia
-- que alguien agregue una ruta nueva y se olvide del parametro, el silencio
-- devolveria justo lo que no corresponde.
--
-- El resto del algoritmo no cambia: consulta OR sobre los lexemas, normalizada
-- con la misma funcion que alimenta el indice, con piso de cobertura y umbral
-- de relevancia. Solo se agrega el filtro por estado.
drop function if exists public.buscar_rag_chunks_lexico(text, integer);
drop function if exists public.buscar_rag_chunks_lexico(text, integer, text[]);

create function public.buscar_rag_chunks_lexico(
  p_query text,
  p_match_count integer,
  p_estados text[]
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
  ocr_doubtful boolean,
  estado_legal text
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with estados as (
    select array(
      select distinct e
      from unnest(coalesce(p_estados, array[]::text[])) as e
      where e in ('vigente', 'derogada', 'proyecto')
    ) as permitidos
  ),
  entrada as (
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
      d.estado_legal,
      c.orden
    from public.rag_chunks c
    join public.rag_documentos d
      on d.id = c.documento_id
    cross join consulta e
    cross join estados s
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
    where cardinality(s.permitidos) > 0
      and d.estado_legal = any(s.permitidos)
      and length(e.texto) >= 2
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
    c.ocr_doubtful,
    c.estado_legal
  from candidatos c
  where c.relevancia >= 0.30
  order by
    c.relevancia desc,
    c.documento_id,
    c.orden,
    c.id
  limit (select max_rows from consulta);
$$;

revoke all on function public.buscar_rag_chunks_lexico(text, integer, text[])
  from public, anon, authenticated;
grant execute on function public.buscar_rag_chunks_lexico(text, integer, text[])
  to service_role;

comment on function public.buscar_rag_chunks_lexico(text, integer, text[]) is
  'Recuperacion fts-spanish-v1 privada. El estado legal es obligatorio: sin estados validos no devuelve nada.';

commit;
