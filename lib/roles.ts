/**
 * Roles municipales y qué puede leer cada uno. Única fuente del lado cliente.
 *
 * Lo que se decide acá tiene su gemelo en PostgreSQL (migración 16): el rol
 * `consulta` no lee las tablas base de `carteles`, `inspecciones` ni
 * `expedientes`, sino vistas sin empresa, CUIT ni padrón. Esto no oculta un
 * dato que el navegador igual recibiría: elige qué fuente pedir.
 */

export type AppRole = "administrador" | "coordinador" | "inspector" | "consulta";

/** Roles con permiso de escritura sobre inspecciones (coincide con la RLS). */
export const OPERATIVE_ROLES: AppRole[] = ["administrador", "coordinador", "inspector"];
export const APP_ROLES: AppRole[] = [...OPERATIVE_ROLES, "consulta"];

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as string[]).includes(value);
}

/**
 * true si el rol puede ver datos personales y tributarios (empresa, CUIT,
 * padrón). Hoy coincide con los roles operativos, pero es una decisión de
 * lectura distinta de la de escritura y se consulta por separado.
 */
export function canSeeFiscalData(role: AppRole | null): boolean {
  return role !== null && OPERATIVE_ROLES.includes(role);
}

/** Tablas cuya versión consultiva omite los campos personales y tributarios. */
export type FiscalTable = "carteles" | "inspecciones" | "expedientes";

/**
 * Fuente a consultar según el rol: la tabla base para roles operativos, la
 * vista redactada para `consulta`. Pedirle la tabla base a una sesión
 * consultiva no devuelve un error sino cero filas, que se leería como
 * "no hay registros": por eso la elección es explícita.
 */
export function fiscalSource(table: FiscalTable, role: AppRole | null): string {
  return canSeeFiscalData(role) ? table : `${table}_consulta`;
}

/** Texto único para un dato que existe pero el rol no puede ver. */
export const RESTRICTED_BY_ROLE_LABEL = "Restringido por rol";

/**
 * Mismo mínimo que valida `asignar_rol` en PostgreSQL. Vive acá para que lo
 * puedan compartir la UI y las rutas del servidor sin arrastrar el cliente
 * Supabase del navegador.
 */
export const ROLE_REASON_MIN_LENGTH = 12;

/** Roles que pueden abrir y gestionar expedientes (RLS de la migración 06). */
export const EXPEDIENTE_ROLES: AppRole[] = ["administrador", "coordinador"];
/** Único rol que resuelve aprobaciones y administra identidades. */
export const ADMIN_ROLES: AppRole[] = ["administrador"];

export interface PermisoFila {
  accion: string;
  detalle: string;
  roles: AppRole[];
}

/**
 * Qué puede hacer cada rol, en un solo lugar.
 *
 * No es una lista escrita a mano para mostrar en pantalla: son las MISMAS
 * constantes que usan `AuthProvider` para calcular `canInspect` y `canSeeFiscal`
 * y que las migraciones repiten en sus `tiene_rol`. Si alguien cambia un
 * permiso y se olvida de la matriz, el test de invariantes falla.
 */
export const PERMISSION_MATRIX: PermisoFila[] = [
  {
    accion: "Leer el registro administrativo",
    detalle: "Ver el mapa con los carteles registrados y sus actuaciones.",
    roles: APP_ROLES,
  },
  {
    accion: "Ver empresa, CUIT y padrón",
    detalle: "El rol consulta lee vistas que directamente no tienen esas columnas.",
    roles: OPERATIVE_ROLES,
  },
  {
    accion: "Filtrar y rankear por empresa",
    detalle: "Un ranking por razón social la reconstruye aunque el campo no se muestre.",
    roles: OPERATIVE_ROLES,
  },
  {
    accion: "Registrar inspecciones y evidencia",
    detalle: "Cargar inspecciones, fotografías y solicitar cambios de estado.",
    roles: OPERATIVE_ROLES,
  },
  {
    accion: "Abrir y gestionar expedientes",
    detalle: "Crear el legajo del cartel e incorporar documentación.",
    roles: EXPEDIENTE_ROLES,
  },
  {
    accion: "Resolver aprobaciones",
    detalle: "Aprobar o rechazar cambios de estado y vínculos, con fundamento.",
    roles: ADMIN_ROLES,
  },
  {
    accion: "Asignar roles",
    detalle: "Cambiar el rol de una cuenta. Exige fundamento y queda asentado.",
    roles: ADMIN_ROLES,
  },
  {
    accion: "Leer la bitácora y los accesos",
    detalle: "Auditoría de actuaciones, cambios de rol y lecturas sensibles.",
    roles: ADMIN_ROLES,
  },
];

export function rolTienePermiso(fila: PermisoFila, rol: AppRole): boolean {
  return fila.roles.includes(rol);
}
