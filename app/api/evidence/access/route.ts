import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PIECES = 40;
const MAX_MOTIVO_LENGTH = 300;
const SIGNED_URL_TTL_SECONDS = 3600;
const DB_TIMEOUT_MS = 10_000;
/** Primera barrera barata por IP; la cuota real es distribuida en PostgreSQL. */
const IP_RATE_LIMIT = { requests: 120, windowMs: 60_000 };

type EvidenceKind = "inspeccion_foto" | "expediente_documento";

type AuthorizedRow = {
  recurso_id: string;
  bucket_id: string;
  storage_path: string;
};

function isAuthorizedRow(value: unknown): value is AuthorizedRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<AuthorizedRow>;
  return (
    typeof row.recurso_id === "string"
    && (row.bucket_id === "inspeccion-fotos" || row.bucket_id === "expediente-docs")
    && typeof row.storage_path === "string"
    && row.storage_path.length > 0
  );
}

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
 * Entrega URLs firmadas de evidencia, y solo después de dejar registrado quién
 * las pidió.
 *
 * Antes la firma se hacía desde el navegador contra un bucket legible por
 * cualquier autenticado: auditar ahí habría sido trivialmente evitable con
 * abrir la consola. Ahora la lectura directa del bucket está revocada y la
 * única vía es esta ruta, que corre con `service_role`.
 *
 * El fail-closed no depende de este archivo: `autorizar_lectura_evidencia`
 * resuelve las rutas y escribe la auditoría en la misma transacción. Si el
 * registro falla, la transacción se deshace y no hay rutas que firmar.
 */
export async function POST(request: Request) {
  const limited = rateLimit(
    `evidence-access:${clientIp(request)}`,
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

  const admin = createAdminClient({ timeoutMs: DB_TIMEOUT_MS });
  if (!admin) return response({ error: "not_configured" }, 503);

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return response({ error: "unauthorized" }, 401);

  let kind: EvidenceKind;
  let ids: string[];
  let motivo: string | null;
  try {
    const body = await request.json() as {
      recurso?: unknown;
      recursoIds?: unknown;
      motivo?: unknown;
    };
    if (body.recurso !== "inspeccion_foto" && body.recurso !== "expediente_documento") {
      return response({ error: "invalid_kind" }, 400);
    }
    kind = body.recurso;
    if (!Array.isArray(body.recursoIds)) return response({ error: "bad_request" }, 400);
    ids = Array.from(new Set(body.recursoIds.filter((id): id is string => typeof id === "string")));
    motivo = typeof body.motivo === "string"
      ? body.motivo.trim().slice(0, MAX_MOTIVO_LENGTH) || null
      : null;
  } catch {
    return response({ error: "bad_request" }, 400);
  }
  if (ids.length === 0 || ids.length > MAX_PIECES || !ids.every((id) => UUID_PATTERN.test(id))) {
    return response({ error: "invalid_request" }, 400);
  }

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return response({ error: "unauthorized" }, 401);

  // Cuota distribuida: no depende de la memoria de una instancia serverless.
  const { data: quota, error: quotaError } = await admin
    .rpc("consumir_cuota_evidencia", { p_actor_id: user.id })
    .single();
  const quotaRow = quota as { permitido?: unknown; reintentar_en?: unknown } | null;
  if (quotaError || typeof quotaRow?.permitido !== "boolean") {
    console.error("evidence access quota:", quotaError?.message ?? "contrato invalido");
    return response({ error: "quota_unavailable" }, 503);
  }
  if (!quotaRow.permitido) {
    return response(
      { error: "rate_limited" },
      429,
      {
        "Retry-After": String(
          typeof quotaRow.reintentar_en === "number"
            ? Math.max(1, Math.ceil(quotaRow.reintentar_en))
            : 60,
        ),
      },
    );
  }

  const { data: authorized, error: authorizeError } = await admin.rpc(
    "autorizar_lectura_evidencia",
    {
      p_recurso: kind,
      p_recurso_ids: ids,
      p_actor_id: user.id,
      p_motivo: motivo,
    },
  );
  if (authorizeError) {
    // El detalle queda en el log del server; al cliente solo el código.
    console.error("evidence access authorize:", authorizeError.message);
    return response({ error: "not_authorized" }, 403);
  }
  if (!Array.isArray(authorized) || authorized.length !== ids.length || !authorized.every(isAuthorizedRow)) {
    console.error("evidence access: contrato invalido de autorizar_lectura_evidencia");
    return response({ error: "not_authorized" }, 403);
  }

  const bucket = authorized[0].bucket_id;
  if (authorized.some((row) => row.bucket_id !== bucket)) {
    console.error("evidence access: el lote mezcla buckets");
    return response({ error: "not_authorized" }, 403);
  }

  const { data: signed, error: signError } = await admin.storage
    .from(bucket)
    .createSignedUrls(authorized.map((row) => row.storage_path), SIGNED_URL_TTL_SECONDS);
  if (signError || !signed || signed.some((item) => !item.signedUrl)) {
    console.error("evidence access sign:", signError?.message ?? "firma incompleta");
    return response({ error: "sign_failed" }, 503);
  }

  const urlByPath = new Map(signed.map((item) => [item.path, item.signedUrl]));
  const urls: Record<string, string> = {};
  for (const row of authorized) {
    const url = urlByPath.get(row.storage_path);
    // Todo o nada: una pieza sin URL no se compensa entregando las demás.
    if (!url) return response({ error: "sign_failed" }, 503);
    urls[row.recurso_id] = url;
  }

  return response({ ok: true, urls });
}
