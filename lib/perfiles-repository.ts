import type { LoadResult } from "@/data/approvals";
import { isAppRole, type AppRole } from "./roles";
import { supabase } from "./supabase";

/** Mismo mínimo que valida `asignar_rol` en PostgreSQL. */
export const ROLE_REASON_MIN_LENGTH = 12;

export interface PerfilMunicipal {
  userId: string;
  nombre: string | null;
  email: string | null;
  rol: AppRole;
  creadoEn: string | null;
  rolCambiadoEn: string | null;
}

export interface CambioDeRol {
  id: string;
  rolAnterior: AppRole | null;
  rolNuevo: AppRole;
  fundamento: string;
  actorNombre: string | null;
  actorRol: AppRole | null;
  createdAt: string;
}

type PerfilRow = {
  user_id: unknown;
  nombre: unknown;
  email: unknown;
  rol: unknown;
  creado_en: unknown;
  rol_cambiado_en: unknown;
};

function toPerfil(row: PerfilRow): PerfilMunicipal | null {
  if (typeof row.user_id !== "string" || !isAppRole(row.rol)) return null;
  return {
    userId: row.user_id,
    nombre: typeof row.nombre === "string" ? row.nombre : null,
    email: typeof row.email === "string" ? row.email : null,
    rol: row.rol,
    creadoEn: typeof row.creado_en === "string" ? row.creado_en : null,
    rolCambiadoEn: typeof row.rol_cambiado_en === "string" ? row.rol_cambiado_en : null,
  };
}

/**
 * Fuente del panel de usuarios. La RPC es `security definer` porque el email
 * vive en `auth.users`, y solo responde a un administrador autenticado.
 *
 * Falla de forma cerrada: un error devuelve `ok: false` y el panel bloquea las
 * acciones en vez de inferir que no hay usuarios.
 */
export async function loadPerfiles(): Promise<LoadResult<PerfilMunicipal[]>> {
  if (!supabase) {
    return { ok: false, data: [], error: "Supabase no está configurado." };
  }
  const { data, error } = await supabase.rpc("listar_perfiles");
  if (error || !Array.isArray(data)) {
    return { ok: false, data: [], error: "No se pudo cargar el padrón de usuarios." };
  }
  const perfiles: PerfilMunicipal[] = [];
  for (const row of data as PerfilRow[]) {
    const perfil = toPerfil(row);
    if (!perfil) {
      return { ok: false, data: [], error: "El padrón de usuarios devolvió un contrato inesperado." };
    }
    perfiles.push(perfil);
  }
  return { ok: true, data: perfiles, error: null };
}

/** Historial de cambios de rol de una cuenta. Tabla inmutable, solo lectura. */
export async function loadCambiosDeRol(userId: string): Promise<LoadResult<CambioDeRol[]>> {
  if (!supabase) {
    return { ok: false, data: [], error: "Supabase no está configurado." };
  }
  const { data, error } = await supabase
    .from("perfiles_historial")
    .select("id, rol_anterior, rol_nuevo, fundamento, actor_nombre, actor_rol, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error || !data) {
    return { ok: false, data: [], error: "No se pudo cargar el historial de roles." };
  }
  const cambios: CambioDeRol[] = [];
  for (const row of data as Record<string, unknown>[]) {
    if (typeof row.id !== "string" || !isAppRole(row.rol_nuevo) || typeof row.created_at !== "string") {
      return { ok: false, data: [], error: "El historial de roles devolvió un contrato inesperado." };
    }
    cambios.push({
      id: row.id,
      rolAnterior: isAppRole(row.rol_anterior) ? row.rol_anterior : null,
      rolNuevo: row.rol_nuevo,
      fundamento: typeof row.fundamento === "string" ? row.fundamento : "",
      actorNombre: typeof row.actor_nombre === "string" ? row.actor_nombre : null,
      actorRol: isAppRole(row.actor_rol) ? row.actor_rol : null,
      createdAt: row.created_at,
    });
  }
  return { ok: true, data: cambios, error: null };
}

export interface AsignarRolResult {
  ok: boolean;
  /** false cuando el rol pedido ya era el vigente (no-op, sin historial). */
  changed: boolean;
  error: string | null;
}

/**
 * Las guardas de `asignar_rol` levantan excepciones con mensajes propios. Se
 * traducen contra esta lista en vez de mostrar el texto crudo de PostgreSQL:
 * un error inesperado no debe volcar detalle de la base en la pantalla.
 */
const KNOWN_ERRORS: { match: RegExp; message: string }[] = [
  { match: /propio rol/i, message: "Nadie puede cambiar su propio rol." },
  { match: /sin administradores/i, message: "No se puede dejar la instancia sin ningún administrador." },
  { match: /12 caracteres/i, message: `El fundamento debe tener al menos ${ROLE_REASON_MIN_LENGTH} caracteres.` },
  { match: /administrador autenticado/i, message: "Solo un administrador autenticado puede asignar roles." },
  { match: /perfil municipal/i, message: "La cuenta afectada no tiene un perfil municipal." },
];

export async function asignarRol(
  userId: string,
  rol: AppRole,
  fundamento: string,
): Promise<AsignarRolResult> {
  if (!supabase) {
    return { ok: false, changed: false, error: "Supabase no está configurado." };
  }
  const { data, error } = await supabase.rpc("asignar_rol", {
    p_user_id: userId,
    p_rol: rol,
    p_fundamento: fundamento.trim(),
  });
  if (error) {
    const known = KNOWN_ERRORS.find((item) => item.match.test(error.message));
    return {
      ok: false,
      changed: false,
      error: known?.message ?? "No se pudo aplicar el cambio de rol.",
    };
  }
  return { ok: true, changed: data === true, error: null };
}
