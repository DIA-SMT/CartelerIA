-- ============================================================================
-- Fase 9 — Registro de carteles desde la UI (migración idempotente)
-- ----------------------------------------------------------------------------
-- Permite que un usuario autenticado con rol operativo registre un cartel del
-- mapa (crea la fila en public.carteles vinculada por territorial_feature_id).
-- Hasta ahora el alta solo era posible offline (seeds/scripts): la tabla tenía
-- policies de lectura y update pero ninguna de INSERT.
--
-- Sin escritura anónima. El índice único sobre territorial_feature_id ya
-- impide registrar dos veces el mismo cartel del mapa.
-- ============================================================================

-- Rol operativo: misma familia que la escritura de inspecciones (funciona
-- antes y después de la migración 07 de rol único).
drop policy if exists carteles_insert_operativo on public.carteles;
create policy carteles_insert_operativo on public.carteles
  for insert to authenticated
  with check (public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[]));

grant insert on public.carteles to authenticated;
