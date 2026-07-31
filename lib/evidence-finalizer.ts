import { supabase } from "./supabase";

export type EvidenceFinalizeKind =
  | "inspeccion_foto"
  | "expediente_documento";

export type EvidenceUploadReservation = {
  ticketId: string;
  bucketId: "inspeccion-fotos" | "expediente-docs";
  storagePath: string;
  expiresAt: string;
};

type ReserveEvidenceInput = {
  kind: EvidenceFinalizeKind;
  entityId: string;
  description: string | null;
  sha256: string;
  byteSize: number;
  mimeType: string;
};

type FinalizeEvidenceInput = {
  accessToken: string;
  ticketId: string;
};

const FINALIZE_MAX_ATTEMPTS = 4;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function isTicketBusy(response: Response): Promise<boolean> {
  if (response.status !== 409) return false;
  try {
    const body = await response.json() as { error?: unknown };
    return body.error === "ticket_busy";
  } catch {
    return false;
  }
}

function busyRetryDelay(response: Response, attempt: number): number {
  const retryAfterSeconds = Number(response.headers.get("Retry-After"));
  const baseDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? retryAfterSeconds * 1_000
    : 250;
  return Math.min(baseDelay * (2 ** attempt), 2_000);
}

/**
 * Reserva una ruta inmutable antes del upload. PostgreSQL valida rol, vínculo,
 * cupo y cantidad de cargas abiertas; el cliente no elige la ruta.
 */
export async function reserveEvidenceUpload(
  input: ReserveEvidenceInput,
): Promise<EvidenceUploadReservation | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("reservar_carga_evidencia", {
    p_tipo: input.kind,
    p_actuacion_id: input.entityId,
    p_descripcion: input.description,
    p_sha256_cliente: input.sha256,
    p_byte_size_declarado: input.byteSize,
    p_mime_declarado: input.mimeType,
  });
  const candidate = Array.isArray(data) ? data[0] : data;
  const row = candidate as {
    ticket_id?: unknown;
    bucket_id?: unknown;
    storage_path?: unknown;
    expira_en?: unknown;
  } | null;
  if (
    error
    || typeof row?.ticket_id !== "string"
    || (row.bucket_id !== "inspeccion-fotos" && row.bucket_id !== "expediente-docs")
    || typeof row.storage_path !== "string"
    || typeof row.expira_en !== "string"
  ) {
    return null;
  }
  return {
    ticketId: row.ticket_id,
    bucketId: row.bucket_id,
    storagePath: row.storage_path,
    expiresAt: row.expira_en,
  };
}

/** Marca una reserva fallida para que el proceso técnico la limpie. */
export async function abandonEvidenceUpload(ticketId: string): Promise<void> {
  if (!supabase) return;
  await supabase.rpc("abandonar_carga_evidencia", {
    p_ticket_id: ticketId,
  });
}

/**
 * Pide al backend que descargue el objeto, calcule la huella sobre los bytes y
 * registre el manifiesto probatorio. Los reintentos reutilizan el mismo ticket.
 */
export async function finalizeEvidence(
  input: FinalizeEvidenceInput,
): Promise<boolean> {
  for (let attempt = 0; attempt < FINALIZE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch("/api/evidence/finalize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ticketId: input.ticketId }),
      });
      if (response.ok) return true;
      if (
        await isTicketBusy(response)
        && attempt < FINALIZE_MAX_ATTEMPTS - 1
      ) {
        await wait(busyRetryDelay(response, attempt));
        continue;
      }
      if (response.status < 500) return false;
    } catch {
      // El ticket y el manifiesto hacen que un reintento sea idempotente.
    }
  }
  return false;
}
