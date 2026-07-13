-- ============================================================================
-- Fase 9 — Eliminar inspecciones desde la UI (migración idempotente)
-- ----------------------------------------------------------------------------
-- La tabla inspecciones tenía policies de select/insert/update pero ninguna de
-- DELETE (y el rol authenticated no tenía el grant). Esto habilita el borrado
-- para roles operativos. Las filas hijas caen en cascada (inspeccion_fotos e
-- inspeccion_historial tienen FK on delete cascade); los archivos del bucket
-- los elimina el cliente antes de borrar la fila (policy de storage ya existe).
-- Sin escritura anónima.
-- ============================================================================

drop policy if exists inspecciones_delete on public.inspecciones;
create policy inspecciones_delete on public.inspecciones
  for delete to authenticated
  using (public.tiene_rol(array['administrador','coordinador','inspector']::public.app_rol[]));

grant delete on public.inspecciones to authenticated;
