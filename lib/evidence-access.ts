import { supabase } from "./supabase";

export type EvidenceKind = "inspeccion_foto" | "expediente_documento";

/** Debe coincidir con MAX_PIECES de app/api/evidence/access/route.ts. */
const MAX_PIECES_PER_REQUEST = 40;

/**
 * Pide al servidor las URLs firmadas de un lote de evidencia.
 *
 * El navegador ya no firma: la lectura directa del bucket está revocada desde
 * la migración 16. La ruta registra quién accede antes de entregar nada, en la
 * misma transacción, así que una URL en mano implica un acceso auditado.
 *
 * Falla de forma explícita: sin URLs no se muestra evidencia a medias. Que una
 * fotografía "no cargue" nunca debe ser la forma en que se entera alguien de
 * que perdió el permiso.
 */
export async function requestEvidenceUrls(
  kind: EvidenceKind,
  ids: string[],
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return new Map();
  if (!supabase) throw new Error("Supabase no está configurado.");

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("No hay sesión para autorizar la evidencia.");

  const urlById = new Map<string, string>();
  for (let start = 0; start < unique.length; start += MAX_PIECES_PER_REQUEST) {
    const chunk = unique.slice(start, start + MAX_PIECES_PER_REQUEST);
    let response: Response;
    try {
      response = await fetch("/api/evidence/access", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ recurso: kind, recursoIds: chunk }),
      });
    } catch {
      throw new Error("No se pudo autorizar el acceso a la evidencia.");
    }
    if (!response.ok) throw new Error("No se pudo autorizar el acceso a la evidencia.");

    let payload: { urls?: Record<string, unknown> };
    try {
      payload = await response.json() as { urls?: Record<string, unknown> };
    } catch {
      throw new Error("No se pudo autorizar el acceso a la evidencia.");
    }
    const urls = payload.urls;
    if (!urls || typeof urls !== "object") {
      throw new Error("No se pudo autorizar el acceso a la evidencia.");
    }
    for (const id of chunk) {
      const url = urls[id];
      if (typeof url !== "string" || url.length === 0) {
        throw new Error("No se pudo autorizar el acceso a la evidencia.");
      }
      urlById.set(id, url);
    }
  }
  return urlById;
}
