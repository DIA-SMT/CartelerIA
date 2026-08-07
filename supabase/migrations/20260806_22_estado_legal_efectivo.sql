-- ============================================================================
-- Fase 22 - El estado legal se aplica de verdad
-- ----------------------------------------------------------------------------
-- Ejecutar despues de 20260806_21_fabrica_normativa.sql.
--
-- Que fallo:
--
-- La migracion 20 agrego `estado_legal` a rag_documentos y el script empezo a
-- mandarlo en el payload de ingesta. Pero `sincronizar_documento_rag` (migracion
-- 14) escribe una LISTA FIJA de columnas y no conoce esa nueva: recibia el dato
-- y lo descartaba en silencio.
--
-- El resultado fue el peor posible. El borrador de la nueva ordenanza se habia
-- ingerido antes de la 20; al aplicarla, el backfill lo marco `vigente` junto
-- con el resto del corpus. Y como la ingesta lo reporta "sin cambios", la
-- sincronizacion de metadatos nunca corregia el estado. O sea: el asistente
-- normativo podia citar como vigente un proyecto sin sancionar, que es
-- exactamente lo que la migracion 20 existia para impedir.
--
-- Como se arregla:
--
-- No se reescribe `sincronizar_documento_rag`. Son 200 lineas ya verificadas y
-- tocarlas para sumar una columna es riesgo sin beneficio. El estado legal pasa
-- a ser un acto explicito y separado, con su propia RPC, en vez de un efecto
-- secundario enterrado en una funcion larga.
--
-- La migracion es idempotente.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Correccion del dato ya cargado
-- ----------------------------------------------------------------------------
-- El identificador va explicito porque la base no conoce el catalogo del
-- repositorio: `doc-16` es el borrador declarado como proyecto en
-- data/internal-documents.ts. Mismo criterio que la migracion 13 al devolver
-- los 13 vinculos heredados a ratificacion.
update public.rag_documentos
set estado_legal = 'proyecto'
where id = 'doc-16'
  and estado_legal <> 'proyecto';

-- ----------------------------------------------------------------------------
-- 2. El estado legal se fija aparte de la sincronizacion del contenido
-- ----------------------------------------------------------------------------
-- Se llama en cada corrida de la ingesta, tanto si el documento cambio como si
-- no: el estado legal de un documento es independiente de si su texto se
-- modifico. Justamente ese acoplamiento fue el que dejo el borrador como
-- vigente.
create or replace function public.fijar_estado_legal_documento(
  p_documento_id text,
  p_estado text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_afectadas integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'El estado legal de un documento lo fija el script de ingesta'
      using errcode = '42501';
  end if;
  if p_estado not in ('vigente', 'derogada', 'proyecto') then
    raise exception 'Estado legal no reconocido'
      using errcode = '22023';
  end if;

  update public.rag_documentos
  set estado_legal = p_estado
  where id = p_documento_id
    and estado_legal is distinct from p_estado;

  get diagnostics v_afectadas = row_count;
  return v_afectadas > 0;
end;
$$;

revoke all on function public.fijar_estado_legal_documento(text, text)
  from public, anon, authenticated;
grant execute on function public.fijar_estado_legal_documento(text, text)
  to service_role;

comment on function public.fijar_estado_legal_documento(text, text) is
  'Fija el estado legal de un documento del corpus. Independiente de la sincronizacion de contenido.';

-- ----------------------------------------------------------------------------
-- 3. Red de seguridad: ningun proyecto puede quedar habilitado para IA externa
-- ----------------------------------------------------------------------------
-- Un texto sin sancionar no sale del entorno bajo ninguna circunstancia, ni
-- siquiera si alguien lo marcara publico por error en el catalogo.
create or replace function public.proteger_documento_proyecto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado_legal = 'proyecto'
     and (new.external_ai_allowed or new.audience = 'publico') then
    raise exception 'Un documento en estado proyecto no puede ser publico ni habilitarse para IA externa'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_rag_documentos_proyecto on public.rag_documentos;
create trigger trg_rag_documentos_proyecto
  before insert or update on public.rag_documentos
  for each row execute function public.proteger_documento_proyecto();

commit;
