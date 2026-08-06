-- ============================================================================
-- Fase 18 - Las cuentas nuevas vuelven a nacer con el rol minimo
-- ----------------------------------------------------------------------------
-- Ejecutar despues de 20260806_17_indicadores_gestion.sql.
--
-- Hallazgo que motiva esta migracion:
--
-- La migracion 10 redefinio `handle_new_user` para que toda cuenta naciera con
-- rol 'consulta', y tanto CLAUDE.md como el roadmap lo daban por hecho desde
-- entonces. En la instancia real la funcion seguia siendo la de la migracion
-- 07, que insertaba 'administrador'. Es decir: durante meses, cualquier cuenta
-- creada desde el Dashboard nacia con el rol maximo, sin que nada lo avisara.
--
-- El desvio salio a la luz recien cuando el trigger `proteger_rol_perfiles`
-- (migracion 16) rechazo un alta con el mensaje 'Un perfil nuevo solo puede
-- nacer con rol consulta'. La guarda funciono; lo que estaba mal era el alta.
--
-- Leccion operativa: verificar una funcion leyendo el archivo del repositorio
-- no prueba nada sobre la base. Las migraciones se corren a mano y una puede
-- quedar a medio aplicar sin dejar rastro.
--
-- La migracion es idempotente y no toca los roles ya asignados: cambiar un rol
-- existente exige `asignar_rol`, con administrador humano y fundamento.
-- ============================================================================

begin;

-- Identica a la definicion de la migracion 10, que es la vigente por contrato.
-- Se reafirma acá para que la base quede alineada con el repositorio.
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

comment on function public.handle_new_user() is
  'Alta de perfil al crear una cuenta. Siempre con rol consulta: promover exige asignar_rol.';

-- Verificacion en la misma transaccion: si el cuerpo de la funcion volviera a
-- crear cuentas privilegiadas, la migracion falla en vez de aplicarse a medias.
do $$
declare
  v_cuerpo text;
begin
  select p.prosrc
  into v_cuerpo
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'handle_new_user';

  if v_cuerpo is null then
    raise exception 'No existe public.handle_new_user: el alta de cuentas no crearia perfil';
  end if;
  if v_cuerpo ~* '''(administrador|coordinador|inspector)''' then
    raise exception 'handle_new_user seguiria creando cuentas con rol privilegiado';
  end if;
  if v_cuerpo !~* '''consulta''' then
    raise exception 'handle_new_user no asigna explicitamente el rol consulta';
  end if;
end $$;

commit;
