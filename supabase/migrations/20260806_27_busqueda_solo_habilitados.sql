-- ============================================================================
-- Fase 27 - La busqueda puede limitarse a lo que si puede salir del municipio
-- ----------------------------------------------------------------------------
-- Ejecutar despues de 20260806_26_habilitacion_ia_externa.sql.
--
-- Problema medido el 2026-08-06 con el Decreto 0609/18 ya habilitado: de cinco
-- consultas municipales tipicas, dos no recuperaban NINGUN fragmento habilitado
-- y las otras tres recuperaban uno solo. El asistente se negaba igual, y desde
-- afuera parecia que la habilitacion no habia servido.
--
-- La causa: la funcion corta en 8 filas ANTES de que nadie mire si el documento
-- puede salir, y `doc-04` (61 fragmentos) se llevaba los lugares. Filtrar
-- despues no puede arreglarlo: para cuando el resultado llega, los fragmentos
-- utiles ya quedaron afuera del corte.
--
-- Por eso el filtro entra en la consulta. Con `p_solo_ia_externa` en true, la
-- busqueda solo considera documentos publicos, revisados por una persona,
-- habilitados para IA externa y sin OCR dudoso. La ruta hace las dos consultas:
-- la restringida es la que va al modelo, la general es la que se muestra en
-- pantalla para leer.
--
-- Se reemplaza la firma de tres argumentos por una de cuatro. Hay que borrarla:
-- `create or replace` con distinta cantidad de argumentos deja las dos vivas y
-- PostgREST elige por nombre de argumento. El cuerpo es identico al de la
-- migracion 20 salvo el parametro nuevo y su predicado.
--
-- OJO: al aplicar esta migracion hay que tener desplegado el codigo que llama
-- con cuatro argumentos. Entre una cosa y la otra, /api/normativa y
-- /api/fabrica devuelven PGRST202.
--
-- La migracion es idempotente.
-- ============================================================================

begin;

drop function if exists public.buscar_rag_chunks_lexico(text, integer);
drop function if exists public.buscar_rag_chunks_lexico(text, integer, text[]);
drop function if exists public.buscar_rag_chunks_lexico(text, integer, text[], boolean);

create function public.buscar_rag_chunks_lexico(
  p_query text,
  p_match_count integer,
  p_estados text[],
  p_solo_ia_externa boolean
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
      -- Lo unico nuevo respecto de la migracion 20. Las cuatro condiciones son
      -- las mismas que aplica la ruta antes de mandar nada afuera: si divergen,
      -- la busqueda devolveria fragmentos que despues se descartan igual.
      and (
        not coalesce(p_solo_ia_externa, false)
        or (
          d.audience = 'publico'
          and d.human_reviewed
          and d.external_ai_allowed
          and not d.ocr_doubtful
        )
      )
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

revoke all on function public.buscar_rag_chunks_lexico(text, integer, text[], boolean)
  from public, anon, authenticated;
grant execute on function public.buscar_rag_chunks_lexico(text, integer, text[], boolean)
  to service_role;

comment on function public.buscar_rag_chunks_lexico(text, integer, text[], boolean) is
  'Recuperacion fts-spanish-v1 privada. El estado legal es obligatorio. Con p_solo_ia_externa solo devuelve documentos habilitados para salir del municipio.';

commit;
