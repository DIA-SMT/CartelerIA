-- ============================================================================
-- Fase 28 - La duda de la maquina la contesta una persona
-- ----------------------------------------------------------------------------
-- Ejecutar despues de 20260806_27_busqueda_solo_habilitados.sql.
--
-- "ocr_doubtful" es una medida de la maquina: el ingest la pone en true si
-- alguna pagina quedo por debajo del umbral de confianza del OCR. Hasta ahora
-- vetaba la salida hacia IA externa por si sola, y eso dejaba un callejon sin
-- salida: la Ordenanza 4728/2014 tiene una pagina con confianza 41, asi que por
-- mas que alguien leyera y corrigiera el texto entero, el documento seguia
-- bloqueado por una bandera que ya no describia nada.
--
-- La regla nueva: el OCR dudoso bloquea SALVO que una persona haya revisado. No
-- se borra la duda de la maquina -queda registrada, y la pantalla la muestra-,
-- se la contesta. Que es justamente para lo que existe "human_reviewed", que
-- solo se enciende por RPC, con administrador humano y fundamento (migracion 26).
--
-- Ojo: la confianza del OCR es una medicion y NO se toca al corregir un texto a
-- mano. Editarla seria falsear una medida. Las dos cosas conviven: la maquina
-- dudo, una persona chequeo.
--
-- La firma no cambia, asi que alcanza con "create or replace": no hay
-- sobrecarga que borrar. El cuerpo es identico al de la migracion 27 salvo ese
-- predicado.
--
-- La migracion es idempotente.
-- ============================================================================

begin;

create or replace function public.buscar_rag_chunks_lexico(
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
      -- Las mismas condiciones que aplica la ruta antes de mandar nada afuera:
      -- si divergen, la busqueda devolveria fragmentos que despues se descartan
      -- igual.
      --
      -- `ocr_doubtful` ya no esta, y es el cambio de esta migracion. Escribir
      -- `or d.human_reviewed` al lado seria una tautologia: la revision humana
      -- ya es obligatoria dos lineas mas arriba, asi que la condicion nunca
      -- cortaria nada y leerla sugeriria un guard que no guarda. La duda de la
      -- maquina sigue registrada en la columna y la pantalla la muestra.
      and (
        not coalesce(p_solo_ia_externa, false)
        or (
          d.audience = 'publico'
          and d.human_reviewed
          and d.external_ai_allowed
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
  'Recuperacion fts-spanish-v1 privada. El estado legal es obligatorio. Con p_solo_ia_externa solo devuelve documentos habilitados; el OCR dudoso bloquea salvo revision humana.';

commit;
