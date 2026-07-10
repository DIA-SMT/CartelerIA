-- ============================================================================
-- Fase 5 — RAG documental (pgvector). Migración idempotente.
-- ----------------------------------------------------------------------------
-- Almacena chunks de texto de los PDFs + sus embeddings para búsqueda semántica.
-- Embeddings: locales (Transformers.js, multilingüe) → vector(384).
--
-- Seguridad: la normativa es pública → lectura anónima. La escritura (ingesta)
-- se hace SOLO con la service-role key desde el script offline; el cliente no
-- inserta nada (sin grants de escritura para anon/authenticated).
-- ============================================================================

create extension if not exists vector;

-- ----------------------------------------------------------------------------
-- 1. Catálogo de documentos ingestados (espejo de data/documents.ts).
--    contenido_hash permite saltear la re-ingesta si el PDF no cambió.
-- ----------------------------------------------------------------------------
create table if not exists public.rag_documentos (
  id            text primary key,          -- = documents.ts id (doc-02, ...)
  titulo        text not null,
  categoria     text not null,
  pdf_url       text not null,
  contenido_hash text,
  paginas       integer,
  chunks        integer not null default 0,
  ingestado_en  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. Chunks + embeddings.
-- ----------------------------------------------------------------------------
create table if not exists public.rag_chunks (
  id           uuid primary key default gen_random_uuid(),
  documento_id text not null references public.rag_documentos(id) on delete cascade,
  pagina       integer,                    -- para "Ver en el documento" (#page=N)
  seccion      text,                       -- "Artículo 12", "Anexo I", ...
  contenido    text not null,
  orden        integer not null default 0,
  embedding    vector(384),
  created_at   timestamptz not null default now()
);

create index if not exists rag_chunks_documento_idx on public.rag_chunks(documento_id);

-- Corrige la dimensión si una migración anterior creó la columna con otro tamaño
-- (en esta etapa las tablas están vacías, así que es seguro). Idempotente.
drop index if exists public.rag_chunks_embedding_idx;
alter table public.rag_chunks alter column embedding type vector(384);
create index if not exists rag_chunks_embedding_idx
  on public.rag_chunks using hnsw (embedding vector_cosine_ops);

-- ----------------------------------------------------------------------------
-- 3. RLS: lectura pública, sin escritura desde el cliente.
-- ----------------------------------------------------------------------------
alter table public.rag_documentos enable row level security;
alter table public.rag_chunks     enable row level security;

drop policy if exists rag_documentos_read on public.rag_documentos;
create policy rag_documentos_read on public.rag_documentos
  for select to anon, authenticated using (true);

drop policy if exists rag_chunks_read on public.rag_chunks;
create policy rag_chunks_read on public.rag_chunks
  for select to anon, authenticated using (true);

grant select on public.rag_documentos to anon, authenticated;
grant select on public.rag_chunks     to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Retrieval: vecinos más cercanos por similitud coseno.
--    Devuelve solo los que superan el umbral (para poder negarse si no hay
--    evidencia suficiente). security invoker → respeta la RLS de lectura.
-- ----------------------------------------------------------------------------
create or replace function public.match_rag_chunks(
  query_embedding vector(384),
  match_count     int   default 6,
  min_similarity  float default 0.2
)
returns table (
  id           uuid,
  documento_id text,
  pagina       integer,
  seccion      text,
  contenido    text,
  similarity   float
)
language sql
stable
as $$
  select c.id, c.documento_id, c.pagina, c.seccion, c.contenido,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.rag_chunks c
  where c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) > min_similarity
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_rag_chunks(vector, int, float) to anon, authenticated;
