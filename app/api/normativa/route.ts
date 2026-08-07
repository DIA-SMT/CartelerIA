import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { NormativaCitation } from "@/data/normativa";
import {
  hasPotentialPii,
  parseCitationReferences,
} from "@/lib/external-ai-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHAT_MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-3.5-haiku";
const MATCH_COUNT = 8;
const REFUSAL_TEXT = "No encontré información suficiente sobre eso en los documentos disponibles.";
const MAX_QUESTION_LENGTH = 500;
const LLM_TIMEOUT_MS = 20_000;
const EXTERNAL_AI_ENABLED = process.env.ENABLE_EXTERNAL_NORMATIVA_AI === "true";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

// Cliente compartido entre requests (anon key, sin sesión): instanciarlo por
// request solo sumaba trabajo por llamada.
interface MatchRow {
  id: string;
  documento_id: string;
  titulo: string;
  pdf_url: string;
  pagina: number | null;
  seccion: string | null;
  contenido: string;
  similarity: number;
  contenido_hash: string | null;
  source_pdf_hash: string | null;
  ingest_contract_version: 0 | 1;
  human_reviewed: boolean;
  external_ai_allowed: boolean;
  audience: "publico" | "interno";
  ocr_doubtful: boolean;
  estado_legal: "vigente" | "derogada" | "proyecto";
}

function isMatchRow(value: unknown): value is MatchRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<MatchRow>;
  return (
    typeof row.id === "string"
    && typeof row.documento_id === "string"
    && typeof row.titulo === "string"
    && typeof row.pdf_url === "string"
    && (row.pagina === null || Number.isInteger(row.pagina))
    && (row.seccion === null || typeof row.seccion === "string")
    && typeof row.contenido === "string"
    && typeof row.similarity === "number"
    && Number.isFinite(row.similarity)
    && (
      row.contenido_hash === null
      || (
        typeof row.contenido_hash === "string"
        && SHA256_PATTERN.test(row.contenido_hash)
      )
    )
    && (
      row.source_pdf_hash === null
      || (
        typeof row.source_pdf_hash === "string"
        && SHA256_PATTERN.test(row.source_pdf_hash)
      )
    )
    && (row.ingest_contract_version === 0 || row.ingest_contract_version === 1)
    && typeof row.human_reviewed === "boolean"
    && typeof row.external_ai_allowed === "boolean"
    && (row.audience === "publico" || row.audience === "interno")
    && typeof row.ocr_doubtful === "boolean"
    // Defensa en profundidad: la RPC ya filtra por estado, pero si alguna vez
    // devolviera otra cosa, acá se corta. Un fragmento de un proyecto sin
    // sancionar no puede llegar a una respuesta normativa por ninguna vía.
    && row.estado_legal === "vigente"
  );
}

const SYSTEM_PROMPT = `Sos un asistente que responde consultas sobre la normativa y documentación municipal de cartelería de San Miguel de Tucumán, usando ÚNICAMENTE los fragmentos de contexto que se te dan.

Reglas:
- Respondé usando SOLO la información de los fragmentos. NO uses conocimiento externo, NO inventes ni supongas datos que no estén.
- Aunque el contexto responda de forma parcial o indirecta, respondé con lo que SÍ aporta (aclarando si es parcial). Es mejor una respuesta acotada y fiel que negarse.
- Citá las fuentes con su número entre corchetes, por ejemplo [1] o [2][3].
- Incluí al menos una cita y usá únicamente números presentes en el contexto. No uses otros corchetes ni formatos de cita.
- Negate ÚNICAMENTE si NINGÚN fragmento del contexto tiene relación con la pregunta. En ese caso respondé EXACTAMENTE con esta frase y nada más: "${REFUSAL_TEXT}"
- Respondé en español, claro y conciso.`;

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  // El retrieval base es full-text dentro de Supabase y no requiere IA externa.
  if (!supabaseUrl || !supabaseAnon || !serviceRoleKey) {
    return NextResponse.json({ error: "not_configured" }, { status: 501 });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data: profile, error: profileError } = await supabase
    .from("perfiles")
    .select("rol")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (
    profileError
    || !profile
    || !["administrador", "coordinador", "inspector", "consulta"].includes(profile.rol as string)
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: quota, error: quotaError } = await supabase
    .rpc("consumir_cuota_api", { p_scope: "normativa" })
    .single();
  const quotaRow = quota as {
    permitido?: unknown;
    reintentar_en?: unknown;
  } | null;
  if (quotaError || typeof quotaRow?.permitido !== "boolean") {
    return NextResponse.json({ error: "quota_unavailable" }, { status: 503 });
  }
  if (!quotaRow.permitido) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            typeof quotaRow.reintentar_en === "number"
              ? Math.max(1, Math.ceil(quotaRow.reintentar_en))
              : 60,
          ),
        },
      },
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
    // 1. Retrieval léxico privado en PostgreSQL. No descarga modelos en el
    // runtime serverless ni envía la pregunta o los documentos a terceros.
    // Solo normativa VIGENTE. El corpus también contiene el proyecto de
    // ordenanza en construcción, y responderle a un agente municipal citando un
    // texto que todavía no se sancionó sería un error grave. El estado es
    // obligatorio en la RPC justamente para que esto no se pueda olvidar.
    // `p_solo_ia_externa: false` a propósito: esta ruta recupera todo lo
    // vigente y decide después si algo puede salir. Restringir acá le sacaría
    // contexto a la respuesta local, que es la que se da cuando la IA externa
    // no interviene — y es la mayoría de las veces.
    const { data, error } = await admin.rpc("buscar_rag_chunks_lexico", {
      p_query: q,
      p_match_count: MATCH_COUNT,
      p_estados: ["vigente"],
      p_solo_ia_externa: false,
    });
    if (error) {
      // El detalle queda en el log del server; al cliente solo el código.
      console.error("normativa retrieval:", error.message);
      return NextResponse.json({ error: "retrieval_error" }, { status: 502 });
    }
    if (!Array.isArray(data) || !data.every(isMatchRow)) {
      console.error("normativa retrieval: invalid RPC contract");
      return NextResponse.json({ error: "retrieval_error" }, { status: 502 });
    }
    const matches = data;

    // 2. Sin evidencia → negarse (sin llamar al LLM).
    if (matches.length === 0) {
      return NextResponse.json({ refused: true, answer: REFUSAL_TEXT, citations: [] });
    }

    // 3. Citas estructuradas + contexto numerado.
    const citations: NormativaCitation[] = matches.map((m, i) => {
      return {
        n: i + 1,
        documentoId: m.documento_id,
        titulo: m.titulo,
        pdfUrl:
          m.audience === "publico" && m.pdf_url.startsWith("/")
            ? m.pdf_url
            : null,
        pagina: m.pagina,
        seccion: m.seccion,
        fragmento: m.contenido.slice(0, 800),
        similarity: Math.round(m.similarity * 100) / 100,
        contenidoHash: m.contenido_hash,
        sourcePdfHash: m.source_pdf_hash,
        audience: m.audience,
        humanReviewed: m.human_reviewed,
        ocrDoubtful: m.ocr_doubtful,
        legalUseReady: Boolean(
          m.contenido_hash
          && m.source_pdf_hash
          && m.ingest_contract_version === 1
          && m.human_reviewed
          && !m.ocr_doubtful,
        ),
      };
    });
    const context = matches
      .map((m, i) => {
        const ref = [m.titulo, m.pagina ? `pág. ${m.pagina}` : null, m.seccion]
          .filter(Boolean)
          .join(", ");
        return `[${i + 1}] (${ref})\n${m.contenido}`;
      })
      .join("\n\n");

    // 4. La recuperación local y sus citas son la respuesta base. La redacción
    // externa requiere una habilitación explícita y nunca es necesaria para
    // conservar los documentos recuperados.
    if (!EXTERNAL_AI_ENABLED) {
      return NextResponse.json({
        refused: false,
        answer: null,
        citations,
        note: "revision_humana_requerida",
      });
    }
    if (!openrouterKey) {
      return NextResponse.json({ refused: false, answer: null, citations, note: "sin_llm" });
    }

    // Ni la pregunta ni los fragmentos recuperados salen del entorno si
    // contienen identificadores personales explícitos. Relevamientos, notas y
    // documentos sin clasificación conocida se tratan como sensibles aunque
    // una expresión regular no alcance a identificar nombres propios.
    const hasRestrictedAdministrativeSource = matches.some((match) => (
      match.audience !== "publico"
        || match.ingest_contract_version !== 1
        || !match.human_reviewed
        || !match.external_ai_allowed
        || match.ocr_doubtful
    ));
    if (hasRestrictedAdministrativeSource) {
      return NextResponse.json({
        refused: false,
        answer: null,
        citations,
        note: "fuente_restringida",
      });
    }
    if (hasPotentialPii(q, context)) {
      return NextResponse.json({
        refused: false,
        answer: null,
        citations,
        note: "pii_detectada",
      });
    }

    // 5. Respuesta redactada con citas (OpenRouter), solo después de superar la
    // política de privacidad.
    let response: Response;
    try {
      response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
    } catch {
      return NextResponse.json({
        refused: false,
        answer: null,
        citations,
        note: "llm_error",
      });
    }
    if (!response.ok) {
      // El LLM falló, pero el retrieval sirvió: devolvemos las fuentes.
      return NextResponse.json({ refused: false, answer: null, citations, note: "llm_error" });
    }
    let completion: { choices?: { message?: { content?: string } }[] };
    try {
      completion = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
    } catch {
      return NextResponse.json({
        refused: false,
        answer: null,
        citations,
        note: "llm_error",
      });
    }
    const rawAnswer = completion.choices?.[0]?.message?.content;
    const answer = typeof rawAnswer === "string" ? rawAnswer.trim() : "";
    const refusedByModel = answer.length === 0
      || answer.toLocaleLowerCase("es").startsWith("no encontré información suficiente");
    if (refusedByModel) {
      return NextResponse.json({
        refused: false,
        answer: null,
        citations,
        note: "llm_refused",
      });
    }

    const referenced = parseCitationReferences(answer, citations.length);
    if (!referenced) {
      return NextResponse.json({
        refused: false,
        answer: null,
        citations,
        note: "citas_invalidas",
      });
    }
    const referencedSet = new Set(referenced);

    return NextResponse.json({
      refused: false,
      answer,
      citations: citations.filter((citation) => referencedSet.has(citation.n)),
    });
  } catch (error) {
    console.error("normativa:", (error as Error).message);
    return NextResponse.json({ error: "server_error" }, { status: 502 });
  }
}
