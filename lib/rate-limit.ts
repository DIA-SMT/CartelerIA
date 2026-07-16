/**
 * Rate limiting por IP en memoria (ventana fija). Protege los endpoints que
 * llaman a OpenRouter con la key propia: sin esto, un loop anónimo es costo
 * ilimitado.
 *
 * Limitación consciente: el estado vive en la instancia del proceso. Alcanza
 * para un deploy de nodo único (el caso actual); si esto pasa a serverless con
 * múltiples instancias, cambiarlo por un backend compartido (p. ej. Upstash).
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Limpieza perezosa para que el Map no crezca sin límite. */
function sweep(now: number) {
  if (buckets.size < 5000) return;
  buckets.forEach((bucket, key) => {
    if (bucket.resetAt <= now) buckets.delete(key);
  });
}

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  sweep(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSeconds: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSeconds: 0 };
}

/** IP del cliente detrás de proxy/CDN; cae a "unknown" en dev local. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
