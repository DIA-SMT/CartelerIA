-- ============================================================================
-- Fase 20 - Fabrica Normativa: corpus por estado legal y articulado en obra
-- ----------------------------------------------------------------------------
-- Ejecutar despues de 20260806_19_bitacora_y_corpus.sql.
--
-- Nota de numeracion: el prompt de este paquete pedia la migracion 17, pero ese
-- numero ya lo ocupa 20260806_17_indicadores_gestion.sql. Va como 20.
--
-- Objetivos:
--   1. El corpus deja de ser una bolsa unica: cada documento declara su estado
--      legal (vigente, derogada, proyecto) y la busqueda lexica exige saber
--      cual se quiere. El asistente normativo responde SOLO con lo vigente:
--      contestar una consulta municipal citando un proyecto sin sancionar seria
--      un error grave, y hasta ahora nada lo impedia porque no habia proyectos.
--   2. Aparece el articulado en construccion: proyecto, articulos y versiones.
--      La persona es la autora; el asistente propone y nunca guarda.
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

-- ----------------------------------------------------------------------------
-- 3. El proyecto de ordenanza en construccion
-- ----------------------------------------------------------------------------
-- El modelo admite varios proyectos desde el principio, aunque la pantalla
-- muestre el activo: normalizar despues, con datos adentro, sale caro.
create table if not exists public.norma_proyecto (
  id                  uuid primary key default gen_random_uuid(),
  titulo              text not null,
  objeto              text,
  estado              text not null default 'borrador',
  documento_origen_id text references public.rag_documentos(id),
  creado_por          uuid references auth.users(id),
  creado_en           timestamptz not null default now(),
  constraint norma_proyecto_estado_check
    check (estado in ('borrador', 'en_revision', 'cerrado', 'elevado'))
);

comment on table public.norma_proyecto is
  'Ordenanza en construccion. El articulado vive en norma_articulo, no en el corpus.';

-- `orden` es lo que manda; `numero` se recalcula al ensamblar, para que
-- reordenar no obligue a renumerar a mano.
--
-- `texto_original` guarda lo que decia el borrador recibido y no se modifica
-- nunca: poder mostrar que decia antes es innegociable cuando hay que explicar
-- por que se cambio.
create table if not exists public.norma_articulo (
  id             uuid primary key default gen_random_uuid(),
  proyecto_id    uuid not null references public.norma_proyecto(id) on delete cascade,
  numero         integer,
  orden          integer not null,
  sumilla        text,
  texto          text not null,
  estado         text not null default 'propuesto',
  origen         text not null,
  texto_original text,
  autor_id       uuid references auth.users(id),
  aprobado_por   uuid references auth.users(id),
  aprobado_en    timestamptz,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint norma_articulo_estado_check
    check (estado in ('propuesto', 'en_revision', 'aprobado', 'descartado')),
  constraint norma_articulo_origen_check
    check (origen in ('borrador_recibido', 'redactado', 'asistente'))
);

create index if not exists norma_articulo_proyecto_idx
  on public.norma_articulo(proyecto_id, orden);

create unique index if not exists norma_articulo_orden_uidx
  on public.norma_articulo(proyecto_id, orden);

comment on column public.norma_articulo.texto_original is
  'Texto del borrador recibido. Inmutable: es el antecedente para explicar un cambio.';

-- Historial inmutable: cada guardado crea una version, nada se sobrescribe.
create table if not exists public.norma_articulo_version (
  id          uuid primary key default gen_random_uuid(),
  articulo_id uuid not null references public.norma_articulo(id) on delete cascade,
  version     integer not null,
  texto       text not null,
  sumilla     text,
  autor_id    uuid references auth.users(id),
  autor_rol   public.app_rol,
  motivo      text,
  creado_en   timestamptz not null default now()
);

create unique index if not exists norma_articulo_version_uidx
  on public.norma_articulo_version(articulo_id, version);

comment on table public.norma_articulo_version is
  'Insert-only e inmutable. Cada guardado agrega una fila; el texto anterior queda.';

alter table public.norma_proyecto          enable row level security;
alter table public.norma_articulo          enable row level security;
alter table public.norma_articulo_version  enable row level security;

-- Lectura para todo perfil municipal reconocido, incluido `consulta`: el rol
-- consultivo observa el proyecto (bloque 6) y para eso necesita leerlo. El
-- articulado no contiene datos personales del administrado.
drop policy if exists norma_proyecto_select on public.norma_proyecto;
create policy norma_proyecto_select on public.norma_proyecto
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector','consulta']::public.app_rol[]
    )
  );

drop policy if exists norma_articulo_select on public.norma_articulo;
create policy norma_articulo_select on public.norma_articulo
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector','consulta']::public.app_rol[]
    )
  );

drop policy if exists norma_articulo_version_select on public.norma_articulo_version;
create policy norma_articulo_version_select on public.norma_articulo_version
  for select to authenticated
  using (
    public.tiene_rol(
      array['administrador','coordinador','inspector','consulta']::public.app_rol[]
    )
  );

-- La escritura no pasa por policies: va exclusivamente por RPC auditadas, igual
-- que el resto del flujo administrativo.
revoke insert, update, delete on public.norma_proyecto
  from anon, authenticated;
revoke insert, update, delete on public.norma_articulo
  from anon, authenticated;
revoke insert, update, delete on public.norma_articulo_version
  from anon, authenticated, service_role;

-- TRUNCATE no ejecuta triggers por fila ni se somete a RLS.
revoke truncate on table
  public.norma_proyecto,
  public.norma_articulo,
  public.norma_articulo_version
from anon, authenticated, service_role;

-- Mismos disparadores que la bitacora legal de la migracion 13.
drop trigger if exists trg_norma_articulo_version_inmutable on public.norma_articulo_version;
create trigger trg_norma_articulo_version_inmutable
  before update or delete on public.norma_articulo_version
  for each row execute function public.proteger_historial_legal_inmutable();

-- `texto_original` no cambia una vez sembrado. Es la unica columna del sistema
-- que se protege por si misma: todo lo demas se versiona, esto se conserva.
create or replace function public.proteger_texto_original_articulo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.texto_original is not null
     and new.texto_original is distinct from old.texto_original then
    raise exception 'El texto original del borrador es inmutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_norma_articulo_texto_original on public.norma_articulo;
create trigger trg_norma_articulo_texto_original
  before update on public.norma_articulo
  for each row execute function public.proteger_texto_original_articulo();

commit;
