-- ============================================================================
-- Fase 7 — Rol único (administrador) para el demo. Migración idempotente.
-- ----------------------------------------------------------------------------
-- Simplifica el modelo: toda cuenta logueada puede hacer todo. No se toca el
-- enum app_rol ni las policies tiene_rol([...]): como todos los perfiles pasan
-- a 'administrador', todas las policies de escritura se cumplen. Se mantiene el
-- principio de "sin escritura anónima". Reversible: reasignar roles y restaurar
-- el default del trigger.
-- ============================================================================

-- 1. Las cuentas nuevas nacen como administrador (antes: 'consulta').
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
    'administrador',
    coalesce(new.raw_user_meta_data->>'nombre', new.email)
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- 2. Todas las cuentas existentes pasan a administrador (no-op si ya lo son).
update public.perfiles
set rol = 'administrador'
where rol is distinct from 'administrador';
