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
