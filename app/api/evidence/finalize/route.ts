import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type EvidenceKind = "inspeccion_foto" | "expediente_documento";

type StartRow = {
  ticket_id: string;
  estado: "ocupada" | "procesando" | "finalizada";
  evidencia_id: string | null;
  tipo: EvidenceKind;
  bucket_id: "inspeccion-fotos" | "expediente-docs";
  storage_path: string;
  sha256_cliente: string;
  byte_size_declarado: number;
  mime_declarado: string;
  lease_token: string | null;
};

function response(
  body: Record<string, unknown>,
  status = 200,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function sniffMime(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...Array.from(bytes.subarray(start, end)));

  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && ascii(1, 4) === "PNG"
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12).toLowerCase();
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand)) {
      return "image/heic";
    }
  }
  return null;
}

async function inspectStoredFile(file: Blob): Promise<{
  ok: true;
  byteSize: number;
  sha256: string;
  mimeType: string;
} | {
  ok: false;
  reason: "empty" | "too_large" | "unsupported_type";
}> {
  if (file.size <= 0) return { ok: false, reason: "empty" };
  if (file.size > MAX_EVIDENCE_BYTES) return { ok: false, reason: "too_large" };

  const hash = createHash("sha256");
  const prefix = new Uint8Array(32);
  let prefixLength = 0;
  let byteSize = 0;
  const reader = file.stream().getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteSize += value.byteLength;
    if (byteSize > MAX_EVIDENCE_BYTES) {
      await reader.cancel();
      return { ok: false, reason: "too_large" };
    }
    hash.update(value);
    if (prefixLength < prefix.length) {
      const take = Math.min(prefix.length - prefixLength, value.byteLength);
      prefix.set(value.subarray(0, take), prefixLength);
      prefixLength += take;
    }
  }

  if (byteSize === 0) return { ok: false, reason: "empty" };
  const mimeType = sniffMime(prefix.subarray(0, prefixLength));
  if (!mimeType) return { ok: false, reason: "unsupported_type" };
  return {
    ok: true,
    byteSize,
    sha256: hash.digest("hex"),
    mimeType,
  };
}

function isValidStartRow(value: unknown): value is StartRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<StartRow>;
  return (
    typeof row.ticket_id === "string"
    && (
      row.estado === "ocupada"
      || row.estado === "procesando"
      || row.estado === "finalizada"
    )
    && (row.tipo === "inspeccion_foto" || row.tipo === "expediente_documento")
    && (row.bucket_id === "inspeccion-fotos" || row.bucket_id === "expediente-docs")
    && typeof row.storage_path === "string"
    && typeof row.sha256_cliente === "string"
    && typeof row.byte_size_declarado === "number"
    && typeof row.mime_declarado === "string"
    && (row.lease_token === null || typeof row.lease_token === "string")
    && (row.evidencia_id === null || typeof row.evidencia_id === "string")
  );
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return response({ error: "not_configured" }, 503);
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return response({ error: "unauthorized" }, 401);

  let ticketId: string;
  try {
    const body = await request.json() as { ticketId?: unknown };
    ticketId = typeof body.ticketId === "string" ? body.ticketId : "";
  } catch {
    return response({ error: "bad_request" }, 400);
  }
  if (!UUID_PATTERN.test(ticketId)) {
    return response({ error: "invalid_ticket" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData.user;
  if (userError || !user) return response({ error: "unauthorized" }, 401);

  const { data: startData, error: startError } = await admin
    .rpc("iniciar_finalizacion_evidencia", {
      p_ticket_id: ticketId,
      p_actor_id: user.id,
    })
    .single();
  if (startError || !isValidStartRow(startData)) {
    return response({ error: "ticket_not_finalizable" }, 409);
  }
  if (startData.estado === "ocupada") {
    return response(
      { error: "ticket_busy" },
      409,
      { "Retry-After": "1" },
    );
  }
  if (startData.estado === "finalizada" && startData.evidencia_id) {
    return response({
      ok: true,
      evidenceId: startData.evidencia_id,
      idempotent: true,
    });
  }
  if (!startData.lease_token) {
    return response({ error: "invalid_finalize_lease" }, 409);
  }

  const reportFailure = async (permanent: boolean, reason: string) => {
    await admin.rpc("reportar_fallo_finalizacion_evidencia", {
      p_ticket_id: ticketId,
      p_lease_token: startData.lease_token,
      p_permanente: permanent,
      p_error: reason.slice(0, 300),
    });
  };

  const { data: file, error: downloadError } = await admin.storage
    .from(startData.bucket_id)
    .download(startData.storage_path);
  if (downloadError || !file) {
    await reportFailure(false, "storage_object_unavailable");
    return response({ error: "storage_object_unavailable" }, 503);
  }

  let inspected: Awaited<ReturnType<typeof inspectStoredFile>>;
  try {
    inspected = await inspectStoredFile(file);
  } catch {
    await reportFailure(false, "storage_read_failed");
    return response({ error: "storage_read_failed" }, 503);
  }
  if (!inspected.ok) {
    await reportFailure(true, inspected.reason);
    return response({ error: "invalid_evidence_file" }, 415);
  }

  const kindAcceptsMime = startData.tipo === "inspeccion_foto"
    ? inspected.mimeType.startsWith("image/")
    : inspected.mimeType === "application/pdf" || inspected.mimeType.startsWith("image/");
  if (
    !kindAcceptsMime
    || inspected.sha256 !== startData.sha256_cliente
    || inspected.byteSize !== startData.byte_size_declarado
    || inspected.mimeType !== startData.mime_declarado
  ) {
    await reportFailure(true, "declared_metadata_mismatch");
    return response({ error: "evidence_integrity_mismatch" }, 422);
  }

  const { data: evidenceId, error: finalizeError } = await admin
    .rpc("completar_finalizacion_evidencia", {
      p_ticket_id: ticketId,
      p_lease_token: startData.lease_token,
      p_sha256: inspected.sha256,
      p_byte_size: inspected.byteSize,
      p_mime_type: inspected.mimeType,
    });
  if (finalizeError || typeof evidenceId !== "string") {
    await reportFailure(false, "manifest_finalize_failed");
    return response({ error: "evidence_finalize_failed" }, 503);
  }

  return response({ ok: true, evidenceId, sha256: inspected.sha256 });
}
