import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente con `service_role` para rutas del servidor.
 *
 * `service_role` bypassea la RLS: es una identidad técnica y nunca una
 * aprobación legal. Toda autorización fina se delega a una RPC de PostgreSQL,
 * no se decide acá.
 *
 * Devuelve null si falta configuración, para que la ruta responda 503 en vez de
 * arrancar a medias. La clave nunca se expone: este módulo solo se importa
 * desde código de servidor.
 */
export function createAdminClient(
  options: { timeoutMs?: number } = {},
): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;

  const { timeoutMs } = options;
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    // Un timeout por request evita que una ruta serverless quede colgada
    // esperando a la base. Se respeta la señal propia si el llamador ya trae una.
    ...(timeoutMs
      ? {
          global: {
            fetch: (input: RequestInfo | URL, init?: RequestInit) =>
              fetch(input, {
                ...init,
                signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
              }),
          },
        }
      : {}),
  });
}
