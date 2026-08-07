import { NextResponse } from "next/server";
import { quitarEncabezadoArticulo } from "@/lib/articulado";
import { hasPotentialPii } from "@/lib/external-ai-policy";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHAT_MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-3.5-haiku";
const EXTERNAL_AI_ENABLED = process.env.ENABLE_EXTERNAL_NORMATIVA_AI === "true";
const MAX_INPUT = 4000;
const LLM_TIMEOUT_MS = 25_000;
const DB_TIMEOUT_MS = 15_000;
const IP_RATE_LIMIT = { requests: 20, windowMs: 60_000 };

type Accion = "proponer_articulo";

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

const SISTEMA_REDACCION = `Sos un asistente de redacción normativa de la Municipalidad de San Miguel de Tucumán. Ayudás a redactar artículos de una ordenanza de cartelería.

Reglas:
- Escribís UN artículo, con forma jurídica, en español rioplatense formal.
- NO encabezás el texto con "ARTÍCULO N", "Art. 1" ni nada parecido, ni siquiera con una equis de relleno: el número lo asigna el sistema según la posición en el articulado. Empezás directamente por el contenido del artículo.
- Usás SOLO lo que está en la idea. No inventás números de artículo, de ordenanza, plazos, montos ni medidas que no estén.
- Si la idea no alcanza para escribir un artículo completo, NO rellenás: devolvés "falta" y decís exactamente qué hay que definir. Es preferible pedir una definición que entregar un artículo verosímil con un vacío adentro.
- No aprobás nada ni afirmás que el texto sea definitivo: lo revisa y lo firma una persona.

Respondé SOLO con JSON: {"suficiente": true, "sumilla": "...", "texto": "..."} o {"suficiente": false, "falta": "qué hay que definir"}.`;

async function llamarModelo(
  sistema: string,
  usuario: string,
  apiKey: string,
): Promise<Record<string, unknown> | null> {
  let respuesta: Response;
  try {
    respuesta = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "CartelerIA · Fábrica Normativa",
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        max_tokens: 1200,
        messages: [
          { role: "system", content: sistema },
          { role: "user", content: usuario },
        ],
      }),
    });
  } catch {
    return null;
  }
  if (!respuesta.ok) return null;

  try {
    const completado = await respuesta.json() as {
      choices?: { message?: { content?: string } }[];
    };
    const crudo = completado.choices?.[0]?.message?.content ?? "";
    // El modelo suele envolver el JSON en un bloque de código.
    const limpio = crudo.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const parseado = JSON.parse(limpio) as unknown;
    return parseado && typeof parseado === "object" ? parseado as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Asistente de la Fábrica Normativa.
 *
 * Pasa una idea escrita en lenguaje llano a un artículo con forma jurídica. No
 * consulta la normativa vigente: el documento que se está escribiendo es la
 * normativa nueva, no un borrador que haya que contrastar contra lo anterior.
 * Eso saca del camino toda la maquinaria de habilitación del corpus, que era el
 * motivo por el que el asistente se negaba a redactar la mayoría de las veces.
 *
 * El asistente PROPONE y nunca guarda. La propuesta vuelve al navegador y una
 * persona la edita y la acepta; recién ahí se crea el artículo. Esta ruta no
 * tiene ninguna vía para escribir en `norma_articulo`.
 */
export async function POST(request: Request) {
  const limited = rateLimit(`fabrica:${clientIp(request)}`, IP_RATE_LIMIT.requests, IP_RATE_LIMIT.windowMs);
  if (!limited.ok) {
    return NextResponse.json({ error: "rate_limited" }, {
      status: 429,
      headers: { "Retry-After": String(limited.retryAfterSeconds), "Cache-Control": "no-store" },
    });
  }

  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const admin = createAdminClient({ timeoutMs: DB_TIMEOUT_MS });
  if (!admin) return response({ error: "not_configured" }, 503);

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return response({ error: "unauthorized" }, 401);

  let accion: Accion;
  let idea = "";
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.accion !== "proponer_articulo") {
      return response({ error: "accion_invalida" }, 400);
    }
    accion = body.accion;
    idea = typeof body.idea === "string" ? body.idea.trim().slice(0, MAX_INPUT) : "";
  } catch {
    return response({ error: "bad_request" }, 400);
  }
  void accion;

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return response({ error: "unauthorized" }, 401);

  const { data: perfil, error: perfilError } = await admin
    .from("perfiles").select("rol").eq("user_id", user.id).maybeSingle();
  const rol = perfil?.rol as string | undefined;
  if (perfilError || !rol || !["administrador", "coordinador", "inspector"].includes(rol)) {
    return response({ error: "forbidden" }, 403);
  }

  const { data: cuota, error: cuotaError } = await admin
    .rpc("consumir_cuota_fabrica", { p_actor_id: user.id }).single();
  const cuotaRow = cuota as { permitido?: unknown; reintentar_en?: unknown } | null;
  if (cuotaError || typeof cuotaRow?.permitido !== "boolean") {
    console.error("fabrica cuota:", cuotaError?.message ?? "contrato inválido");
    return response({ error: "quota_unavailable" }, 503);
  }
  if (!cuotaRow.permitido) return response({ error: "rate_limited" }, 429);

  if (idea.length < 20) return response({ error: "input_insuficiente" }, 400);

  // Lo único que sigue frenando la salida: que la asistencia esté apagada, o
  // que la idea traiga identificadores personales. Las dos son baratas y
  // ninguna depende de configurar nada por documento.
  if (!EXTERNAL_AI_ENABLED || !openrouterKey) {
    return response({ ok: true, asistido: false, motivo: "asistencia_deshabilitada" });
  }
  if (hasPotentialPii(idea)) {
    return response({ ok: true, asistido: false, motivo: "pii_detectada" });
  }

  const propuesta = await llamarModelo(
    SISTEMA_REDACCION,
    `Idea a convertir en artículo:\n${idea}`,
    openrouterKey,
  );
  if (!propuesta) return response({ error: "asistente_no_disponible" }, 502);

  if (propuesta.suficiente !== true) {
    return response({
      ok: true,
      asistido: true,
      suficiente: false,
      falta: typeof propuesta.falta === "string" ? propuesta.falta : "Faltan definiciones para escribir el artículo.",
    });
  }

  // La propuesta vuelve al navegador. No se guarda: la crea una persona al
  // aceptarla desde el lienzo.
  //
  // El encabezado se saca acá aunque el prompt ya lo prohíba: el modelo lo
  // escribe igual de vez en cuando, y un "ARTÍCULO X.-" dentro del cuerpo sale
  // duplicado en el documento final, porque la numeración la pone el ensamblado
  // según la posición.
  return response({
    ok: true,
    asistido: true,
    suficiente: true,
    sumilla: typeof propuesta.sumilla === "string" ? propuesta.sumilla : null,
    texto: typeof propuesta.texto === "string"
      ? quitarEncabezadoArticulo(propuesta.texto)
      : "",
  });
}
