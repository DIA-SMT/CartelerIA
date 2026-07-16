import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { documents } from "@/data/documents";
import type { NormativaCitation } from "@/data/normativa";
import { embedText } from "@/lib/embeddings";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAT_MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-3.5-haiku";
const MATCH_COUNT = 8;
const MIN_SIMILARITY = 0.2;
const REFUSAL_TEXT = "No encontré información suficiente sobre eso en los documentos disponibles.";
const MAX_QUESTION_LENGTH = 500;
const LLM_TIMEOUT_MS = 20_000;
const RATE_LIMIT = { requests: 10, windowMs: 60_000 };

// Cliente compartido entre requests (anon key, sin sesión): instanciarlo por
// request solo sumaba trabajo por llamada.
let cachedSupabase: SupabaseClient | null = null;
function getSupabase(url: string, anonKey: string): SupabaseClient {
  if (!cachedSupabase) cachedSupabase = createClient(url, anonKey, { auth: { persistSession: false } });
  return cachedSupabase;
}

interface MatchRow {
  id: string;
  documento_id: string;
  pagina: number | null;
  seccion: string | null;
  contenido: string;
  similarity: number;
}

const SYSTEM_PROMPT = `Sos un asistente que responde consultas sobre la normativa y documentación municipal de cartelería de San Miguel de Tucumán, usando ÚNICAMENTE los fragmentos de contexto que se te dan.

Reglas:
- Respondé usando SOLO la información de los fragmentos. NO uses conocimiento externo, NO inventes ni supongas datos que no estén.
- Aunque el contexto responda de forma parcial o indirecta, respondé con lo que SÍ aporta (aclarando si es parcial). Es mejor una respuesta acotada y fiel que negarse.
- Citá las fuentes con su número entre corchetes, por ejemplo [1] o [2][3].
- Negate ÚNICAMENTE si NINGÚN fragmento del contexto tiene relación con la pregunta. En ese caso respondé EXACTAMENTE con esta frase y nada más: "${REFUSAL_TEXT}"
- Respondé en español, claro y conciso.`;

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  // Embeddings locales (sin key). Solo hace falta Supabase para el retrieval.
  if (!supabaseUrl || !supabaseAnon) {
    return NextResponse.json({ error: "not_configured" }, { status: 501 });
  }

  const limited = rateLimit(`normativa:${clientIp(request)}`, RATE_LIMIT.requests, RATE_LIMIT.windowMs);
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
  const q = question.trim();

  try {
    // 1. Embeder la pregunta (local).
    const queryEmbedding = await embedText(q);

    // 2. Retrieval por similitud (solo chunks sobre el umbral).
    const supabase = getSupabase(supabaseUrl, supabaseAnon);
    const { data, error } = await supabase.rpc("match_rag_chunks", {
      query_embedding: queryEmbedding,
      match_count: MATCH_COUNT,
      min_similarity: MIN_SIMILARITY,
    });
    if (error) {
      // El detalle queda en el log del server; al cliente solo el código.
      console.error("normativa retrieval:", error.message);
      return NextResponse.json({ error: "retrieval_error" }, { status: 502 });
    }
    const matches = (data ?? []) as MatchRow[];

    // 3. Sin evidencia → negarse (sin llamar al LLM).
    if (matches.length === 0) {
      return NextResponse.json({ refused: true, answer: REFUSAL_TEXT, citations: [] });
    }

    // 4. Citas estructuradas + contexto numerado.
    const docById = new Map(documents.map((d) => [d.id, d]));
    const citations: NormativaCitation[] = matches.map((m, i) => {
      const doc = docById.get(m.documento_id);
      return {
        n: i + 1,
        documentoId: m.documento_id,
        titulo: doc?.title ?? m.documento_id,
        pdfUrl: doc?.pdfUrl ?? null,
        pagina: m.pagina,
        seccion: m.seccion,
        fragmento: m.contenido.slice(0, 320),
        similarity: Math.round(m.similarity * 100) / 100,
      };
    });
    const context = matches
      .map((m, i) => {
        const doc = docById.get(m.documento_id);
        const ref = [doc?.title ?? m.documento_id, m.pagina ? `pág. ${m.pagina}` : null, m.seccion]
          .filter(Boolean)
          .join(", ");
        return `[${i + 1}] (${ref})\n${m.contenido}`;
      })
      .join("\n\n");

    // 5. Sin LLM configurado: devolver solo las fuentes (sin redacción).
    if (!openrouterKey) {
      return NextResponse.json({ refused: false, answer: null, citations, note: "sin_llm" });
    }

    // 6. Respuesta redactada con citas (OpenRouter).
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${openrouterKey}`,
        "Content-Type": "application/json",
        "X-Title": "CartelerIA",
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        max_tokens: 700,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Contexto:\n${context}\n\nPregunta: ${q}` },
        ],
      }),
    });
    if (!response.ok) {
      // El LLM falló, pero el retrieval sirvió: devolvemos las fuentes.
      return NextResponse.json({ refused: false, answer: null, citations, note: "llm_error" });
    }
    const completion = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const answer = (completion.choices?.[0]?.message?.content ?? "").trim();
    const refused = answer.length === 0 || answer.toLowerCase().startsWith("no encontré información suficiente");

    return NextResponse.json({
      refused,
      answer: refused ? REFUSAL_TEXT : answer,
      citations: refused ? [] : citations,
    });
  } catch (error) {
    console.error("normativa:", (error as Error).message);
    return NextResponse.json({ error: "server_error" }, { status: 502 });
  }
}
