import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { APP_ROLES, ROLE_REASON_MIN_LENGTH } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_EMAIL_LENGTH = 254;
const MAX_NOMBRE_LENGTH = 120;
const MAX_FUNDAMENTO_LENGTH = 500;
const DB_TIMEOUT_MS = 15_000;
/** Invitar es una acción rara y costosa: el límite por IP es deliberadamente bajo. */
const IP_RATE_LIMIT = { requests: 10, windowMs: 60_000 };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function response(
  body: Record<string, unknown>,
  status = 200,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

/**
 * Invita una cuenta municipal y le asigna su rol en un solo paso.
 *
 * El alta la hace `service_role`, porque crear una cuenta es una operación de
 * administración de Supabase. Pero el rol NO lo asigna `service_role`: la ruta
 * reenvía el token de quien invita y llama a `asignar_rol` con su identidad, de
 * modo que el cambio queda en `perfiles_historial` con actor y fundamento
 * reales. `service_role` sigue siendo una identidad técnica, nunca una
 * aprobación.
 *
 * Si la asignación de rol fallara, la cuenta queda creada con rol `consulta`:
 * el error deja a la persona con menos permisos, nunca con más.
 */
export async function POST(request: Request) {
  const limited = rateLimit(
    `invitar:${clientIp(request)}`,
    IP_RATE_LIMIT.requests,
    IP_RATE_LIMIT.windowMs,
  );
  if (!limited.ok) {
    return response(
      { error: "rate_limited" },
      429,
      { "Retry-After": String(limited.retryAfterSeconds) },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const admin = createAdminClient({ timeoutMs: DB_TIMEOUT_MS });
  if (!admin || !supabaseUrl || !anonKey) {
    return response({ error: "not_configured" }, 503);
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return response({ error: "unauthorized" }, 401);

  let email: string;
  let nombre: string | null;
  let rol: string;
  let fundamento: string;
  try {
    const body = await request.json() as Record<string, unknown>;
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    nombre = typeof body.nombre === "string" && body.nombre.trim()
      ? body.nombre.trim().slice(0, MAX_NOMBRE_LENGTH)
      : null;
    rol = typeof body.rol === "string" ? body.rol : "";
    fundamento = typeof body.fundamento === "string" ? body.fundamento.trim() : "";
  } catch {
    return response({ error: "bad_request" }, 400);
  }

  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return response({ error: "invalid_email" }, 400);
  }
  if (!(APP_ROLES as string[]).includes(rol)) {
    return response({ error: "invalid_role" }, 400);
  }
  // El fundamento solo se exige cuando hay algo que asentar: una cuenta que
  // queda en `consulta` nace así por el trigger, sin cambio que registrar.
  const requiereFundamento = rol !== "consulta";
  if (requiereFundamento
    && (fundamento.length < ROLE_REASON_MIN_LENGTH || fundamento.length > MAX_FUNDAMENTO_LENGTH)) {
    return response({ error: "invalid_reason" }, 400);
  }

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const invitante = userData?.user;
  if (userError || !invitante) return response({ error: "unauthorized" }, 401);

  const { data: perfil, error: perfilError } = await admin
    .from("perfiles")
    .select("rol")
    .eq("user_id", invitante.id)
    .maybeSingle();
  if (perfilError || perfil?.rol !== "administrador") {
    return response({ error: "forbidden" }, 403);
  }

  const { data: invitado, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    email,
    { data: nombre ? { nombre } : undefined },
  );
  if (inviteError || !invitado?.user) {
    console.error("invitar usuario:", inviteError?.message ?? "sin usuario devuelto");
    const yaExiste = /already|registered|exists/i.test(inviteError?.message ?? "");
    return response(
      { error: yaExiste ? "email_ya_registrado" : "invite_failed" },
      yaExiste ? 409 : 502,
    );
  }

  if (!requiereFundamento) {
    return response({ ok: true, userId: invitado.user.id, rol: "consulta" });
  }

  // El rol lo asigna quien invita, con su propio token: la traza queda a su
  // nombre y con su fundamento, igual que un cambio hecho desde el panel.
  const comoInvitante = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { error: rolError } = await comoInvitante.rpc("asignar_rol", {
    p_user_id: invitado.user.id,
    p_rol: rol,
    p_fundamento: fundamento,
  });
  if (rolError) {
    console.error("invitar usuario / asignar_rol:", rolError.message);
    // La cuenta existe y quedó en `consulta`: se avisa para que se resuelva
    // desde el panel, en vez de dejar creer que tiene el rol pedido.
    return response(
      { ok: true, userId: invitado.user.id, rol: "consulta", rolAsignado: false },
      207,
    );
  }

  return response({ ok: true, userId: invitado.user.id, rol, rolAsignado: true });
}
