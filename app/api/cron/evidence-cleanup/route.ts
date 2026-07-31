import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type CleanupTicket = {
  ticket_id: string;
  bucket_id: "inspeccion-fotos" | "expediente-docs";
  storage_path: string;
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isCleanupTicket(value: unknown): value is CleanupTicket {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<CleanupTicket>;
  return (
    typeof row.ticket_id === "string"
    && (row.bucket_id === "inspeccion-fotos" || row.bucket_id === "expediente-docs")
    && typeof row.storage_path === "string"
  );
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (
    !cronSecret
    || request.headers.get("authorization") !== `Bearer ${cronSecret}`
  ) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "not_configured" }, 503);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const workerToken = randomUUID();
  const { data, error } = await admin.rpc("reclamar_cargas_huerfanas", {
    p_limite: 50,
    p_worker_token: workerToken,
  });
  if (error || !Array.isArray(data)) {
    return json({ error: "cleanup_claim_failed" }, 503);
  }

  const tickets = data.filter(isCleanupTicket);
  if (tickets.length !== data.length) {
    return json({ error: "invalid_cleanup_claim" }, 503);
  }

  let removed = 0;
  let pending = 0;
  for (const bucketId of ["inspeccion-fotos", "expediente-docs"] as const) {
    const group = tickets.filter((ticket) => ticket.bucket_id === bucketId);
    if (group.length === 0) continue;
    const { error: removeError } = await admin.storage
      .from(bucketId)
      .remove(group.map((ticket) => ticket.storage_path));

    const confirmations = await Promise.all(group.map((ticket) =>
      admin.rpc("confirmar_limpieza_carga", {
        p_ticket_id: ticket.ticket_id,
        p_worker_token: workerToken,
        p_eliminada: !removeError,
        p_error: removeError ? "storage_remove_failed" : null,
      })
    ));
    for (const confirmation of confirmations) {
      if (!removeError && !confirmation.error && confirmation.data === true) {
        removed += 1;
      } else {
        pending += 1;
      }
    }
  }

  return json({
    ok: pending === 0,
    claimed: tickets.length,
    removed,
    pending,
  }, pending === 0 ? 200 : 503);
}
