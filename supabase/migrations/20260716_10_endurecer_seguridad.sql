-- ============================================================================
-- Fase 10 — Endurecimiento de seguridad (migración idempotente)
-- ----------------------------------------------------------------------------
-- Revierte los dos atajos del demo que no pueden llegar a producción:
--
--   1. Las cuentas nuevas nacían como 'administrador' (migración 07): cualquier
--      persona que se registrara obtenía escritura sobre carteles, inspecciones
--      y expedientes. Vuelven a nacer como 'consulta' (solo lectura); un
--      administrador asciende roles editando public.perfiles.
--
--   2. El rol anon podía hacer UPDATE de domicilio/coordenadas de cualquier
--      cartel (schema.sql + rls_fix.sql, pensado para el MVP sin login). La
--      corrección de ubicación pasa a exigir sesión con rol operativo, la
--      misma familia que inspecciones y el alta de carteles (migración 08).
--
-- Los roles ya asignados en public.perfiles NO se tocan: las cuentas del
-- equipo siguen operativas. Para bajar una cuenta puntual:
--   update public.perfiles set rol = 'consulta' where user_id = '<uuid>';
--
-- PASO MANUAL (no expresable en SQL): deshabilitar el registro público en
-- Supabase Dashboard → Authentication → Sign In / Up → "Allow new users to
-- sign up". Con el alta abierta, cualquier cuenta nueva —aunque nazca como
-- 'consulta'— sigue siendo una puerta de entrada innecesaria: las cuentas
-- las crea un administrador.
-- ============================================================================

-- 1. Las cuentas nuevas nacen con el rol mínimo.
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

-- 2. Fin de la escritura anónima sobre carteles.
drop policy if exists "carteles_public_location_update" on public.carteles;
revoke update on public.carteles from anon;

-- La corrección de ubicación queda para sesiones con rol operativo.
drop policy if exists carteles_update_operativo on public.carteles;
create policy carteles_update_operativo on public.carteles
  for update to authenticated
  using (public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[]))
  with check (public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[]));
