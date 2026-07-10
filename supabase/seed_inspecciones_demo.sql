-- ============================================================================
-- Demo: inspecciones de prueba para "Preguntale al mapa" (Fase 4b)
-- ----------------------------------------------------------------------------
-- Pegar en el SQL editor de Supabase (corre con privilegios, ignora la RLS).
-- Requiere las migraciones de Fase 3 ya aplicadas (tabla public.inspecciones).
-- Es idempotente: borra solo las filas demo de estas empresas y las recrea.
--
-- Resultado esperado del ranking por "observaciones" (estado con_observaciones):
--   Publicidad Alfa = 3, Carteles Beta = 2, Gamma SRL = 1
-- ============================================================================
do $$
declare c_id text;
begin
  select id into c_id from public.carteles order by id limit 1;
  if c_id is null then
    raise exception 'La tabla public.carteles está vacía: seedeá los carteles primero.';
  end if;

  -- Limpieza idempotente (solo las empresas demo).
  delete from public.inspecciones where empresa in ('Publicidad Alfa', 'Carteles Beta', 'Gamma SRL');

  insert into public.inspecciones (cartel_id, estado, empresa) values
    (c_id, 'con_observaciones', 'Publicidad Alfa'),
    (c_id, 'con_observaciones', 'Publicidad Alfa'),
    (c_id, 'con_observaciones', 'Publicidad Alfa'),
    (c_id, 'regular',           'Publicidad Alfa'),
    (c_id, 'con_observaciones', 'Carteles Beta'),
    (c_id, 'con_observaciones', 'Carteles Beta'),
    (c_id, 'con_observaciones', 'Gamma SRL'),
    (c_id, 'regular',           'Gamma SRL');
end $$;
