-- ============================================================================
-- Fase 17 - Indicadores de gestion calculados en PostgreSQL
-- ----------------------------------------------------------------------------
-- Ejecutar despues de 20260806_16_gobernanza_identidades.sql.
--
-- Objetivos:
--   1. Los siete indicadores del roadmap se calculan en la base, no en el
--      navegador: el arbol es 100% cliente y traer el registro entero para
--      contar seria caro y ademas expondria datos que el rol no puede ver.
--   2. Cada indicador declara su procedencia con el vocabulario acordado y dice
--      explicitamente cuando NO tiene datos suficientes. Un denominador en cero
--      no se presenta como 0%.
--   3. La segmentacion respeta los permisos: el rol `consulta` no puede
--      segmentar por empresa, porque un filtro por razon social la reconstruye
--      aunque el campo no se muestre (migracion 16).
--
-- La migracion es idempotente y no crea tablas: solo lee.
--
-- Nota sobre la ventana temporal: filtra por fecha de alta del registro
-- administrativo, que es el hecho que el sistema puede fechar con certeza.
-- ============================================================================

begin;

-- La funcion es `security definer` porque desde la migracion 16 el rol
-- `consulta` no lee las tablas base. Devuelve unicamente agregados: ninguna
-- razon social, CUIT ni padron sale de aca, para ningun rol.
create or replace function public.indicadores_gestion(
  p_desde date default null,
  p_hasta date default null,
  p_zona text default null,
  p_empresa text default null,
  p_estado text default null,
  p_inspector uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rol public.app_rol;
  v_desde timestamptz;
  v_hasta timestamptz;
  v_zona text;
  v_empresa text;
  v_estado text;
  v_resultado jsonb;
begin
  if auth.uid() is null
     or not public.tiene_rol(
       array['administrador','coordinador','inspector','consulta']::public.app_rol[]
     ) then
    raise exception 'Se requiere un perfil municipal autenticado'
      using errcode = '42501';
  end if;

  select p.rol
  into v_rol
  from public.perfiles p
  where p.user_id = auth.uid();

  v_zona    := nullif(btrim(coalesce(p_zona, '')), '');
  v_empresa := nullif(btrim(coalesce(p_empresa, '')), '');
  v_estado  := nullif(btrim(coalesce(p_estado, '')), '');

  if v_empresa is not null and v_rol = 'consulta'::public.app_rol then
    raise exception 'Este rol no puede segmentar por empresa'
      using errcode = '42501';
  end if;
  if v_estado is not null
     and not exists (select 1 from public.inspeccion_estados s where s.key = v_estado) then
    raise exception 'Estado de inspeccion no reconocido'
      using errcode = '22023';
  end if;

  -- `p_hasta` es inclusivo. Por omision, los ultimos 365 dias.
  v_desde := coalesce(p_desde, current_date - interval '365 days')::timestamptz;
  v_hasta := (coalesce(p_hasta, current_date) + interval '1 day')::timestamptz;
  if v_desde >= v_hasta then
    raise exception 'El periodo solicitado esta invertido'
      using errcode = '22023';
  end if;

  with universo as (
    select c.*
    from public.carteles c
    where c.created_at >= v_desde
      and c.created_at < v_hasta
      and (v_zona is null or c.zone = v_zona)
      and (v_empresa is null or c.empresa ilike '%' || v_empresa || '%')
  ),
  inspecciones_universo as (
    select i.*
    from public.inspecciones i
    join universo u on u.id = i.cartel_id
    where (v_estado is null or i.estado = v_estado)
      and (p_inspector is null or i.inspector_id = p_inspector)
  ),
  expedientes_universo as (
    select e.*
    from public.expedientes e
    join universo u on u.id = e.cartel_id
  ),

  -- 1. Cobertura: vinculos ratificados por un administrador sobre el registro.
  -- El universo territorial vive en los GeoJSON servidos, no en PostgreSQL: la
  -- base informa lo que le consta y el denominador territorial lo aporta la
  -- capa, declarado como dato territorial calculado.
  cobertura as (
    select
      count(*) filter (where u.vinculo_estado = 'aprobado')::int as aprobados,
      count(*) filter (where u.vinculo_estado = 'pendiente')::int as pendientes,
      count(*)::int as registrados
    from universo u
  ),

  -- 2. Inspecciones completadas sobre programadas.
  inspecciones_resumen as (
    select
      count(*)::int as total,
      count(*) filter (where i.programada_para is not null)::int as programadas,
      count(*) filter (
        where i.programada_para is not null and i.inspeccionada_en is not null
      )::int as completadas,
      count(*) filter (
        where s.categoria in ('resultado', 'regularizacion', 'cierre')
      )::int as con_resultado
    from inspecciones_universo i
    join public.inspeccion_estados s on s.key = i.estado
  ),

  -- 3. Regularizacion: se mide sobre el historial, no sobre el estado vigente,
  -- porque un cartel ya regularizado dejo de figurar como observado.
  observados as (
    select distinct i.cartel_id
    from inspecciones_universo i
    join public.inspeccion_historial h on h.inspeccion_id = i.id
    where h.estado_nuevo = 'con_observaciones'
  ),
  regularizados as (
    select distinct i.cartel_id
    from inspecciones_universo i
    join public.inspeccion_historial h on h.inspeccion_id = i.id
    where h.estado_nuevo = 'regularizado'
      and i.cartel_id in (select cartel_id from observados)
  ),
  regularizacion as (
    select
      (select count(*) from observados)::int as observados,
      (select count(*) from regularizados)::int as regularizados
  ),

  -- 4. Demora hasta la primera actuacion registrada sobre el cartel.
  primera_actuacion as (
    select extract(epoch from (min(i.created_at) - u.created_at)) as segundos
    from universo u
    join inspecciones_universo i on i.cartel_id = u.id
    group by u.id, u.created_at
  ),
  demora_primera as (
    select
      count(*)::int as casos,
      percentile_cont(0.5) within group (order by segundos) as mediana
    from primera_actuacion
    where segundos is not null
  ),

  -- 5. Demora hasta el cierre: regularizacion o cierre de la inspeccion, o
  -- resolucion o archivo del expediente, lo que ocurra primero.
  cierre_actuacion as (
    select extract(epoch from (
      least(
        (
          select min(h.created_at)
          from public.inspeccion_historial h
          join inspecciones_universo i on i.id = h.inspeccion_id
          where i.cartel_id = u.id
            and h.estado_nuevo in ('regularizado', 'cerrado')
        ),
        (
          select min(coalesce(e.cerrado_en, e.updated_at))
          from expedientes_universo e
          where e.cartel_id = u.id
            and e.estado in ('resuelto', 'archivado')
        )
      ) - u.created_at
    )) as segundos
    from universo u
  ),
  demora_cierre as (
    select
      count(*)::int as casos,
      percentile_cont(0.5) within group (order by segundos) as mediana
    from cierre_actuacion
    where segundos is not null
  ),

  -- 6. Backlog: actuaciones abiertas por antiguedad. `es_final` sale del
  -- catalogo, no de una lista repetida acá.
  abiertos as (
    select now() - i.created_at as edad
    from inspecciones_universo i
    join public.inspeccion_estados s on s.key = i.estado
    where not s.es_final
    union all
    select now() - e.created_at
    from expedientes_universo e
    join public.expediente_estados s on s.key = e.estado
    where not s.es_final
  ),
  backlog as (
    select
      count(*)::int as total,
      count(*) filter (where edad < interval '31 days')::int as r0_30,
      count(*) filter (where edad >= interval '31 days' and edad < interval '91 days')::int as r31_90,
      count(*) filter (where edad >= interval '91 days' and edad < interval '181 days')::int as r91_180,
      count(*) filter (where edad >= interval '181 days')::int as r181
    from abiertos
  ),

  -- 7. Calidad de datos. "Fuente oficial" es el vinculo territorial ratificado
  -- por un administrador humano: es la unica verificacion con valor legal.
  calidad as (
    select
      count(*)::int as total,
      count(*) filter (
        where btrim(coalesce(u.empresa, '')) <> ''
          and btrim(coalesce(u.cuit, '')) <> ''
          and btrim(coalesce(u.domicilio, '')) <> ''
      )::int as completos,
      count(*) filter (where u.latitud is not null and u.longitud is not null)::int as georreferenciados,
      count(*) filter (where u.vinculo_estado = 'aprobado')::int as fuente_oficial
    from universo u
  )

  select jsonb_build_object(
    'periodo', jsonb_build_object(
      'desde', to_char(v_desde, 'YYYY-MM-DD'),
      'hasta', to_char(v_hasta - interval '1 day', 'YYYY-MM-DD'),
      'zona', v_zona,
      'empresa', v_empresa,
      'estado', v_estado,
      'inspector', p_inspector
    ),
    'indicadores', jsonb_build_array(
      jsonb_build_object(
        'clave', 'cobertura_territorial',
        'etiqueta', 'Cobertura territorial',
        'procedencia', 'administrativo_oficial',
        'unidad', 'porcentaje',
        'suficiente', cobertura.registrados > 0,
        'numerador', cobertura.aprobados,
        'denominador', cobertura.registrados,
        'valor', round(100.0 * cobertura.aprobados / nullif(cobertura.registrados, 0), 1),
        'detalle', case
          when cobertura.registrados = 0
            then 'No hay registros administrativos en el periodo seleccionado.'
          else cobertura.pendientes || ' vinculos esperan ratificacion administrativa.'
        end
      ),
      jsonb_build_object(
        'clave', 'inspecciones_completadas',
        'etiqueta', 'Inspecciones completadas',
        'procedencia', 'aportado_inspeccion',
        'unidad', 'porcentaje',
        'suficiente', inspecciones_resumen.programadas > 0,
        'numerador', inspecciones_resumen.completadas,
        'denominador', inspecciones_resumen.programadas,
        'valor', round(100.0 * inspecciones_resumen.completadas / nullif(inspecciones_resumen.programadas, 0), 1),
        'detalle', case
          when inspecciones_resumen.programadas = 0
            then 'Todavia no se programan inspecciones con fecha, asi que no hay un total contra el cual medir. Hay '
                 || inspecciones_resumen.total || ' inspecciones cargadas y '
                 || inspecciones_resumen.con_resultado || ' con resultado registrado.'
          else inspecciones_resumen.total || ' inspecciones cargadas en el periodo.'
        end
      ),
      jsonb_build_object(
        'clave', 'tasa_regularizacion',
        'etiqueta', 'Tasa de regularizacion',
        'procedencia', 'administrativo_oficial',
        'unidad', 'porcentaje',
        'suficiente', regularizacion.observados > 0,
        'numerador', regularizacion.regularizados,
        'denominador', regularizacion.observados,
        'valor', round(100.0 * regularizacion.regularizados / nullif(regularizacion.observados, 0), 1),
        'detalle', case
          when regularizacion.observados = 0
            then 'Ningun cartel del periodo recibio observaciones todavia.'
          else 'Carteles regularizados sobre los que recibieron observaciones.'
        end
      ),
      jsonb_build_object(
        'clave', 'demora_primera_inspeccion',
        'etiqueta', 'Tiempo hasta la primera inspeccion',
        'procedencia', 'administrativo_oficial',
        'unidad', 'dias',
        'suficiente', demora_primera.casos > 0,
        'numerador', demora_primera.casos,
        'denominador', null,
        'valor', round((demora_primera.mediana / 86400.0)::numeric, 1),
        'detalle', case
          when demora_primera.casos = 0
            then 'Ningun cartel del periodo tiene una inspeccion registrada.'
          else 'Mediana sobre ' || demora_primera.casos || ' carteles, desde el alta del registro.'
        end
      ),
      jsonb_build_object(
        'clave', 'demora_resolucion',
        'etiqueta', 'Tiempo de resolucion',
        'procedencia', 'administrativo_oficial',
        'unidad', 'dias',
        'suficiente', demora_cierre.casos > 0,
        'numerador', demora_cierre.casos,
        'denominador', null,
        'valor', round((demora_cierre.mediana / 86400.0)::numeric, 1),
        'detalle', case
          when demora_cierre.casos = 0
            then 'Ningun caso del periodo llego a regularizacion, resolucion ni archivo.'
          else 'Mediana sobre ' || demora_cierre.casos || ' casos cerrados.'
        end
      ),
      jsonb_build_object(
        'clave', 'antiguedad_backlog',
        'etiqueta', 'Antiguedad del backlog',
        'procedencia', 'administrativo_oficial',
        'unidad', 'rangos',
        'suficiente', backlog.total > 0,
        'numerador', backlog.total,
        'denominador', null,
        'valor', null,
        'rangos', jsonb_build_array(
          jsonb_build_object('clave', 'hasta_30',  'etiqueta', 'Hasta 30 dias',   'cantidad', backlog.r0_30),
          jsonb_build_object('clave', 'de_31_90',  'etiqueta', '31 a 90 dias',    'cantidad', backlog.r31_90),
          jsonb_build_object('clave', 'de_91_180', 'etiqueta', '91 a 180 dias',   'cantidad', backlog.r91_180),
          jsonb_build_object('clave', 'mas_180',   'etiqueta', 'Mas de 180 dias', 'cantidad', backlog.r181)
        ),
        'detalle', case
          when backlog.total = 0
            then 'No hay actuaciones abiertas en el periodo seleccionado.'
          else backlog.total || ' actuaciones abiertas entre inspecciones y expedientes.'
        end
      ),
      jsonb_build_object(
        'clave', 'calidad_datos',
        'etiqueta', 'Calidad de datos',
        'procedencia', 'pendiente_verificacion',
        'unidad', 'porcentaje',
        'suficiente', calidad.total > 0,
        'numerador', calidad.completos,
        'denominador', calidad.total,
        'valor', round(100.0 * calidad.completos / nullif(calidad.total, 0), 1),
        'rangos', jsonb_build_array(
          jsonb_build_object(
            'clave', 'completos',
            'etiqueta', 'Registro completo',
            'cantidad', calidad.completos
          ),
          jsonb_build_object(
            'clave', 'georreferenciados',
            'etiqueta', 'Georreferenciados',
            'cantidad', calidad.georreferenciados
          ),
          jsonb_build_object(
            'clave', 'fuente_oficial',
            'etiqueta', 'Con vinculo ratificado',
            'cantidad', calidad.fuente_oficial
          )
        ),
        'detalle', case
          when calidad.total = 0
            then 'No hay registros administrativos en el periodo seleccionado.'
          else 'Sobre ' || calidad.total || ' registros del periodo.'
        end
      )
    )
  )
  into v_resultado
  from cobertura, inspecciones_resumen, regularizacion,
       demora_primera, demora_cierre, backlog, calidad;

  return v_resultado;
end;
$$;

revoke all on function public.indicadores_gestion(date, date, text, text, text, uuid)
  from public, anon;
grant execute on function public.indicadores_gestion(date, date, text, text, text, uuid)
  to authenticated;

comment on function public.indicadores_gestion(date, date, text, text, text, uuid) is
  'Los siete indicadores de gestion, agregados en PostgreSQL. Nunca devuelve datos personales.';

-- Zonas disponibles para segmentar, sin exponer el registro. La vista consultiva
-- alcanza para el rol `consulta`, que no lee la tabla base.
create or replace function public.zonas_disponibles()
returns table (zona text, cantidad integer)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null
     or not public.tiene_rol(
       array['administrador','coordinador','inspector','consulta']::public.app_rol[]
     ) then
    raise exception 'Se requiere un perfil municipal autenticado'
      using errcode = '42501';
  end if;

  return query
  select c.zone, count(*)::integer
  from public.carteles c
  where btrim(coalesce(c.zone, '')) <> ''
  group by c.zone
  order by count(*) desc, c.zone asc;
end;
$$;

revoke all on function public.zonas_disponibles() from public, anon;
grant execute on function public.zonas_disponibles() to authenticated;

comment on function public.zonas_disponibles() is
  'Zonas del registro con su conteo, para segmentar indicadores sin leer el padron.';

commit;
