import { NextResponse } from "next/server";
import { quitarEncabezadoArticulo } from "@/lib/articulado";
import { hasPotentialPii } from "@/lib/external-ai-policy";
import { sanearFragmento, verificarHallazgos, type HallazgoSinVerificar } from "@/lib/norma-citas";
import { articulosRelacionados, type ArticuloComparable } from "@/lib/norma-relacionados";
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

type Accion = "proponer_articulo" | "revisar_proyecto";

/** Cuántos artículos del documento se le muestran al modelo por consulta. */
const RELACIONADOS = 8;

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

const SISTEMA_REVISION = `Sos un asistente que revisa un artículo contra los otros artículos de la MISMA ordenanza, para detectar que el documento no se contradiga a sí mismo.

Reglas absolutas sobre las citas:
- Cada hallazgo lleva una cita COPIADA CARÁCTER POR CARÁCTER del artículo con el que choca. Una cita que no aparezca literal se descarta.
- NUNCA reescribas ni parafrasees una cita.
- Devolver una lista vacía es una respuesta VÁLIDA y FRECUENTE. Lo normal es que un artículo no choque con ninguno. No inventes hallazgos para llenar el formulario.
- La confianza por omisión es "baja". Solo subila si el artículo citado dice literalmente lo que afirmás.

Tipos:
- "contradiccion": los dos artículos mandan cosas incompatibles (por ejemplo dos máximos distintos para lo mismo).
- "repeticion": los dos dicen lo mismo, y eso deja el documento con la misma regla en dos lugares.
- "termino_sin_definir": el artículo usa un término con peso jurídico que ningún otro artículo define.

En "referencia" ponés el número de artículo con el que choca, así: "Artículo 12".

Respondé SOLO con JSON: {"hallazgos": [{"tipo": "...", "severidad": "baja|media|alta", "descripcion": "...", "referencia": "Artículo N", "cita": "texto literal del otro artículo", "confianza": "baja|media|alta"}]}.`;

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
 * Revisa un artículo contra los otros del mismo documento.
 *
 * No consulta la normativa vigente ni el corpus: el documento que se escribe es
 * la normativa nueva, y lo que interesa acá es que no se contradiga a sí mismo.
 *
 * No escribe nada. Los hallazgos vuelven al navegador y no bloquean ninguna
 * exportación: son para leer y decidir, no una compuerta.
 */
async function revisarProyecto(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  articuloId: string,
  texto: string,
  apiKey: string,
) {
  const { data: fila, error: filaError } = await admin
    .from("norma_articulo")
    .select("proyecto_id")
    .eq("id", articuloId)
    .maybeSingle();
  if (filaError || !fila) return response({ error: "articulo_no_encontrado" }, 404);

  const { data: crudos, error: hermanosError } = await admin
    .from("norma_articulo")
    .select("id, numero, orden, sumilla, texto, estado")
    .eq("proyecto_id", (fila as { proyecto_id: string }).proyecto_id)
    .neq("id", articuloId);
  if (hermanosError || !Array.isArray(crudos)) {
    return response({ error: "retrieval_error" }, 502);
  }

  // Los quitados del documento no cuentan: no van a estar en la ordenanza, así
  // que chocar con ellos no es un problema.
  const hermanos: ArticuloComparable[] = (crudos as Record<string, unknown>[])
    .filter((row) => row.estado !== "descartado" && typeof row.texto === "string")
    .map((row) => ({
      id: String(row.id),
      numero: typeof row.numero === "number" ? row.numero : Number(row.orden ?? 0),
      sumilla: typeof row.sumilla === "string" ? row.sumilla : null,
      texto: row.texto as string,
    }));

  const relacionados = articulosRelacionados(texto, hermanos, RELACIONADOS);
  if (relacionados.length === 0) {
    // Ningún artículo comparte vocabulario con este. Es una respuesta legítima
    // y no hace falta gastar una llamada al modelo para confirmarla.
    return response({ ok: true, asistido: true, hallazgos: [], descartados: 0, comparados: 0 });
  }

  const saneados = relacionados.map((articulo) => sanearFragmento(articulo.texto));
  const contexto = relacionados
    .map((articulo, indice) => `Artículo ${articulo.numero}${articulo.sumilla ? ` — ${articulo.sumilla}` : ""}\n${saneados[indice]}`)
    .join("\n\n");

  const salida = await llamarModelo(
    SISTEMA_REVISION,
    `Otros artículos del mismo documento:\n${contexto}\n\nArtículo a revisar:\n${texto}`,
    apiKey,
  );
  if (!salida) return response({ error: "asistente_no_disponible" }, 502);

  const crudosHallazgos = Array.isArray(salida.hallazgos) ? salida.hallazgos : [];
  const { verificados, descartados } = verificarHallazgos(
    crudosHallazgos as HallazgoSinVerificar[],
    saneados,
  );
  if (descartados.length > 0) {
    // Un modelo que inventa citas es información operativa, no algo para
    // ocultar. Queda en el log del servidor.
    console.warn(`fabrica revision: ${descartados.length} hallazgo(s) descartados por cita no verificable`);
  }

  return response({
    ok: true,
    asistido: true,
    hallazgos: verificados,
    descartados: descartados.length,
    comparados: relacionados.length,
  });
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
  let articuloId = "";
  let textoArticulo = "";
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.accion !== "proponer_articulo" && body.accion !== "revisar_proyecto") {
      return response({ error: "accion_invalida" }, 400);
    }
    accion = body.accion;
    idea = typeof body.idea === "string" ? body.idea.trim().slice(0, MAX_INPUT) : "";
    articuloId = typeof body.articuloId === "string" ? body.articuloId : "";
    textoArticulo = typeof body.texto === "string" ? body.texto.trim().slice(0, MAX_INPUT) : "";
  } catch {
    return response({ error: "bad_request" }, 400);
  }

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

  const entrada = accion === "proponer_articulo" ? idea : textoArticulo;
  if (entrada.length < 20) return response({ error: "input_insuficiente" }, 400);

  // Lo único que sigue frenando la salida: que la asistencia esté apagada, o
  // que el texto traiga identificadores personales. Las dos son baratas y
  // ninguna depende de configurar nada por documento.
  if (!EXTERNAL_AI_ENABLED || !openrouterKey) {
    return response({ ok: true, asistido: false, motivo: "asistencia_deshabilitada" });
  }
  if (hasPotentialPii(entrada)) {
    return response({ ok: true, asistido: false, motivo: "pii_detectada" });
  }

  if (accion === "revisar_proyecto") {
    return revisarProyecto(admin, articuloId, textoArticulo, openrouterKey);
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
