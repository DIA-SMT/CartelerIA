import { NextResponse } from "next/server";
import { parseQueryIntent } from "@/data/map-query";
import { interpretQuestion } from "@/lib/map-query-interpreter";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUESTION_LENGTH = 500;
const RATE_LIMIT = { requests: 30, windowMs: 60_000 };

/**
 * Endpoint conservado por compatibilidad con clientes anteriores.
 *
 * La interpretación es local y determinista: esta ruta no llama a OpenRouter
 * ni reenvía la pregunta a ningún proveedor externo. El cliente actual ejecuta
 * el mismo intérprete directamente en el navegador.
 *
 * No tiene sesión, así que no tiene rol: el intent se revalida con los permisos
 * mínimos. Nunca devuelve un intent que filtre o agrupe por empresa, aunque el
 * intérprete local lo proponga.
 */
export async function POST(request: Request) {
  const limited = rateLimit(
    `ask:${clientIp(request)}`,
    RATE_LIMIT.requests,
    RATE_LIMIT.windowMs,
  );
  if (!limited.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSeconds) },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const question = (body as Record<string, unknown>).question;
  if (typeof question !== "string" || question.trim().length === 0) {
    return NextResponse.json({ error: "empty_question" }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json({ error: "question_too_long" }, { status: 400 });
  }

  const intent = parseQueryIntent(
    interpretQuestion(question.trim()),
    { canSeeFiscalData: false },
  );
  if (!intent) {
    return NextResponse.json({ error: "forbidden_field" }, { status: 403 });
  }

  return NextResponse.json({ intent, source: "rules" });
}
