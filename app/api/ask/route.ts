import { NextResponse } from "next/server";
import { parseQueryIntent, QUERY_FIELDS } from "@/data/map-query";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OpenRouter (compatible con la API de OpenAI). El modelo se elige por env; el
// default es un Claude barato. Verificá el slug exacto en openrouter.ai/models.
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-3.5-haiku";
// Una pregunta real sobre el mapa entra holgada en 500 caracteres; el límite
// corta el abuso de contexto (el input viaja tal cual al LLM).
const MAX_QUESTION_LENGTH = 500;
const LLM_TIMEOUT_MS = 20_000;
const RATE_LIMIT = { requests: 10, windowMs: 60_000 };

function fieldsDoc(): string {
  return Object.values(QUERY_FIELDS)
    .map((f) => {
      const ds = f.dataset ?? "carteles";
      const base = f.kind === "enum"
        ? `- [${ds}] ${f.field} (${f.label}) — enum, valores: ${f.values!.map((v) => v.value).join(", ")}`
        : `- [${ds}] ${f.field} (${f.label}) — ${f.kind}`;
      return base;
    })
    .join("\n");
}

const SYSTEM_PROMPT = `Sos un asistente que traduce preguntas en español sobre un mapa municipal de cartelería urbana (San Miguel de Tucumán) a una estructura JSON de consulta llamada QueryIntent. NO contás ni ves los datos: el sistema ejecuta tu QueryIntent sobre los carteles reales. Tu única tarea es interpretar la pregunta.

Reglas invariables:
- Usá SOLO los campos y valores enumerados abajo. Si la pregunta menciona algo que no se puede expresar con ellos (ej. "alquilado", "propietario", "observaciones"), agregá ese término al array "unsupported" y no inventes un filtro.
- Nunca inventes datos ni estados. No decidís estados oficiales.
- "observaciones", "infracciones" y "multas" pertenecen al módulo de inspecciones y NO están disponibles acá: reportalos en "unsupported".

Campos consultables:
${fieldsDoc()}

Hay DOS datasets. Cada campo está marcado con [carteles] o [inspecciones] arriba.
- "carteles" (default): el mapa territorial. Preguntas sobre ubicación, estado administrativo, deuda, habilitación, tipo, zona sensible.
- "inspecciones": la tabla de inspecciones registradas. Preguntas sobre resultados de inspección, "observaciones", o rankings de empresas por inspecciones.
Un predicado NO puede mezclar campos de datasets distintos: elegí un solo dataset por consulta.

Estructura de salida (JSON, sin markdown, sin texto extra):
{
  "operation": "count" | "list" | "aggregate",
  "dataset": "carteles" | "inspecciones",   // default "carteles"
  "predicate": <Predicate opcional>,
  "aggregate": { "groupBy": <campo>, "top": <número opcional> },  // solo si operation="aggregate"
  "applyToMap": <boolean>,
  "unsupported": <string[]>,
  "explanation": "<breve, en español, cómo interpretaste la consulta>"
}

Predicate es uno de:
- { "field": <campo>, "op": "eq"|"neq", "value": "<valor enum válido>" }
- { "field": <campo>, "op": "in", "value": ["<valor>", ...] }
- { "field": <campo>, "op": "contains", "value": "<texto>" }        // solo campos de texto (empresa)
- { "field": <campo>, "op": "lt"|"lte"|"gt"|"gte", "value": <número> } // solo campos number
- { "field": "sensitiveZone", "op": "is", "value": true|false }
- { "op": "and"|"or", "clauses": [<Predicate>, ...] }

Convenciones:
- "cuántos", "cantidad", "número de" → operation "count".
- "mostrame", "listame", "cuáles son" → operation "list" (applyToMap true).
- "qué empresa tiene más ...", "ranking de empresas" → operation "aggregate", groupBy "empresa", top 5.
- "fuera de zona" → visualStatus eq fuera_zona. "con deuda" → visualStatus eq deuda. "no registrado" → visualStatus eq no_registrado. "habilitado" → visualStatus eq habilitado.
- "sin habilitación" → enablementStatus eq no_habilitable.
- "riesgoso"/"prioridad alta"/"crítico" → controlPriority in ["alta","critica"].
- "zona sensible", "sensible", "escuela", "hospital", "plaza", "cerca de (una) escuela/hospital/plaza" → sensitiveZone is true. Si la pregunta combina "riesgoso" y un lugar sensible, usá un "and" con ambas condiciones.
- Dataset inspecciones: "observaciones"/"con observaciones" → estadoInspeccion eq con_observaciones. "qué empresa tiene más observaciones", "ranking de empresas" → dataset "inspecciones", operation "aggregate", groupBy "empresaInspeccion", top 5. "cuántas inspecciones con observaciones" → dataset "inspecciones", operation "count".

Ejemplos:
Pregunta: "¿Cuántos están fuera de zona?"
{"operation":"count","predicate":{"field":"visualStatus","op":"eq","value":"fuera_zona"},"applyToMap":false,"unsupported":[],"explanation":"Conté los carteles con estado administrativo fuera de zona permitida."}

Pregunta: "Mostrame carteles riesgosos cerca de zonas sensibles"
{"operation":"list","predicate":{"op":"and","clauses":[{"field":"controlPriority","op":"in","value":["alta","critica"]},{"field":"sensitiveZone","op":"is","value":true}]},"applyToMap":true,"unsupported":[],"explanation":"Busqué carteles de prioridad alta o crítica que están en zona sensible."}

Pregunta: "Mostrame carteles alquilados sin habilitación"
{"operation":"list","predicate":{"field":"enablementStatus","op":"eq","value":"no_habilitable"},"applyToMap":true,"unsupported":["alquiler"],"explanation":"Filtré carteles no habilitables. No hay dato de alquiler."}

Pregunta: "¿Qué empresa tiene más observaciones?"
{"operation":"aggregate","dataset":"inspecciones","predicate":{"field":"estadoInspeccion","op":"eq","value":"con_observaciones"},"aggregate":{"groupBy":"empresaInspeccion","top":5},"applyToMap":false,"unsupported":[],"explanation":"Ranking de empresas por inspecciones con observaciones."}

Respondé ÚNICAMENTE con el JSON.`;

function safeJsonParse(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    // Sin key configurada: el cliente cae al intérprete por reglas.
    return NextResponse.json({ error: "not_configured" }, { status: 501 });
  }

  const limited = rateLimit(`ask:${clientIp(request)}`, RATE_LIMIT.requests, RATE_LIMIT.windowMs);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  let question: unknown;
  try {
    ({ question } = await request.json());
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (typeof question !== "string" || question.trim().length === 0) {
    return NextResponse.json({ error: "empty_question" }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json({ error: "question_too_long" }, { status: 400 });
  }

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "CartelerIA",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: question.trim() },
        ],
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ error: "llm_error" }, { status: 502 });
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    const intent = parseQueryIntent(safeJsonParse(content));
    if (!intent) {
      return NextResponse.json({ error: "invalid_intent" }, { status: 422 });
    }
    return NextResponse.json({ intent, source: "ai" });
  } catch {
    return NextResponse.json({ error: "llm_error" }, { status: 502 });
  }
}
