-- ============================================================================
-- Fase 3 — Perfil automático al registrarse (migración idempotente)
-- ----------------------------------------------------------------------------
-- Garantiza que cada usuario autenticado tenga una fila en public.perfiles.
-- El rol por defecto es 'consulta' (solo lectura): NO puede escribir hasta que
-- un administrador lo eleve a inspector / coordinador / administrador.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfiles (user_id, rol, nombre)
  values (
    new.id,
    'consulta',
    coalesce(new.raw_user_meta_data->>'nombre', new.email)
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_auth_user_created on auth.users;
create trigger trg_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- Para habilitar a un usuario como inspector (ejecutar manualmente):
--
--   update public.perfiles
--   set rol = 'inspector'
--   where user_id = (select id from auth.users where email = 'inspector@smt.gob.ar');
--
-- Roles disponibles: 'administrador', 'coordinador', 'inspector', 'consulta'.
-- ----------------------------------------------------------------------------
