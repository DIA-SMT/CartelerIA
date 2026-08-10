-- ============================================================================
-- Fase 31 - Borrar las piezas de la Fabrica que quedaron sin uso
-- ----------------------------------------------------------------------------
-- Ejecutar despues de 20260807_30_parametro_sin_cita_obligatoria.sql.
--
-- Tres piezas se construyeron y hoy no las llama nadie. No es que esten de
-- reserva por si vuelven: cada una perdio su motivo cuando la Fabrica dejo de
-- ser un expediente y paso a ser una mesa de redaccion.
--
--   norma_parametro / confirmar_parametro   (migracion 23, relajada por la 30)
--     El simulador salio del editor de articulos y no guarda nada: es una
--     calculadora sobre el registro administrativo. Nadie carga un parametro.
--   norma_diagnostico / registrar_diagnosticos / atender_diagnostico   (23)
--     Sin uso desde que se saco el contraste contra la normativa vigente.
--   norma_observacion / crear_observacion / atender_observacion   (24)
--     Sin uso desde que se sacaron las observaciones de las areas.
--
-- Una tabla vacia que nadie escribe se lee como una funcion apagada, y la
-- proxima persona que abra el esquema va a preguntarse por que la Fabrica tiene
-- diagnosticos que no aparecen en ninguna pantalla. Se borra para que el
-- esquema diga lo que el sistema hace.
--
-- Lo que NO se toca, porque esta vivo: norma_proyecto, norma_articulo,
-- norma_articulo_version, actor_fabrica(), guardar_articulo, crear_articulo,
-- cambiar_estado_articulo, reordenar_articulos, sembrar_articulado,
-- crear_proyecto_norma y consumir_cuota_fabrica -esta ultima la usa
-- app/api/fabrica/route.ts en cada llamada al asistente-.
--
-- ----------------------------------------------------------------------------
-- ANTES DE CORRER: esto borra datos y no hay vuelta atras
-- ----------------------------------------------------------------------------
-- Para ver que se lleva, corre primero esto en el SQL Editor:
--
--   select 'norma_parametro'   as tabla, count(*) from public.norma_parametro
--   union all
--   select 'norma_diagnostico', count(*) from public.norma_diagnostico
--   union all
--   select 'norma_observacion', count(*) from public.norma_observacion;
--
-- Si alguna trae filas que te importan -por ejemplo parametros que cargaste
-- probando el panel viejo- exportalas antes; el simulador de hoy no las lee.
--
-- Si nunca corriste la migracion 30, saltala: tocaba `norma_parametro`, que
-- esta borra. Correrla despues de esta falla con 42P01.
--
-- ----------------------------------------------------------------------------
-- DESPUES DE CORRER, para comprobar que no quedo nada colgado
-- ----------------------------------------------------------------------------
--   select tablename from pg_tables
--   where schemaname = 'public' and tablename like 'norma\_%';
--     -- deben quedar exactamente tres: norma_articulo,
--     -- norma_articulo_version y norma_proyecto.
--
--   select proname from pg_proc
--   where proname in ('confirmar_parametro','registrar_diagnosticos',
--                     'atender_diagnostico','crear_observacion',
--                     'atender_observacion','proteger_diagnostico',
--                     'proteger_observacion');
--     -- debe devolver cero filas.
--
-- La migracion es idempotente.
-- ============================================================================

begin;

-- Las tablas se llevan sus policies, indices y triggers puestos. No hace falta
-- `cascade`: ninguna otra cosa depende de ellas, y si algo dependiera preferimos
-- que la migracion falle a que se lleve por delante algo que no miramos.
drop table if exists public.norma_parametro;
drop table if exists public.norma_diagnostico;
drop table if exists public.norma_observacion;

-- Las funciones que solo existian para escribir esas tablas. La firma completa
-- es obligatoria: `drop function` a secas falla si hubiera sobrecargas, y aca
-- justamente queremos enterarnos si quedo alguna.
drop function if exists public.confirmar_parametro(uuid, text, jsonb, text, text, text);
drop function if exists public.registrar_diagnosticos(uuid, jsonb);
drop function if exists public.atender_diagnostico(uuid, text);
drop function if exists public.crear_observacion(uuid, text);
drop function if exists public.atender_observacion(uuid, text);

-- Y los dos guardianes de inmutabilidad, que se quedaron sin tabla que cuidar.
-- Van al final a proposito: mientras exista el trigger, la funcion no se puede
-- borrar.
drop function if exists public.proteger_diagnostico();
drop function if exists public.proteger_observacion();

commit;
