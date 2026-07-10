"use client";

import { useState } from "react";
import { BookOpenText, FileText, Info, Loader2, Scale, Search, X } from "lucide-react";
import type { NormativaResponse } from "@/data/normativa";

type Props = {
  onOpenDocument: (documentoId: string, page: number | null) => void;
};

const EXAMPLES = [
  "¿Qué problemas genera la cartelería sin control?",
  "¿Qué proponen para ordenar la cartelería?",
  "¿Qué son los corredores publicitarios?",
];

export function NormativaAsk({ onOpenDocument }: Props) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<NormativaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/normativa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      if (response.status === 501) {
        setError("El asistente de normativa no está configurado en este entorno.");
        return;
      }
      if (!response.ok) {
        setError("No se pudo consultar la normativa. Reintentá en un momento.");
        return;
      }
      setResult((await response.json()) as NormativaResponse);
    } catch {
      setError("No se pudo consultar la normativa. Verificá tu conexión.");
    } finally {
      setLoading(false);
    }
  };

  return <section aria-label="Consultar normativa" className="mb-6 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50/70 to-white p-4 shadow-sm">
    <div className="flex items-center gap-2">
      <span className="grid size-7 place-items-center rounded-lg bg-blue-600 text-white"><Scale size={14}/></span>
      <div>
        <b className="text-xs text-ink">Consultar normativa</b>
        <p className="text-[9px] font-semibold text-slate-400">Preguntá sobre los documentos. Responde solo con lo que dicen, citando la fuente. Distinto de “Preguntale al mapa” (territorio).</p>
      </div>
    </div>

    <form onSubmit={(event) => { event.preventDefault(); ask(question); }} className="mt-3 flex items-center gap-2">
      <div className="flex flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
        <Search size={14} className="shrink-0 text-slate-400"/>
        <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ej: ¿qué dice la normativa sobre la contaminación visual?" className="min-w-0 flex-1 bg-transparent text-[11px] font-semibold text-slate-700 outline-none placeholder:text-slate-400"/>
        {question && <button type="button" onClick={() => { setQuestion(""); setResult(null); setError(null); }} aria-label="Limpiar" className="text-slate-400 hover:text-blue-700"><X size={13}/></button>}
      </div>
      <button type="submit" disabled={loading || !question.trim()} className="primary-button compact justify-center disabled:cursor-not-allowed disabled:opacity-60">{loading ? <Loader2 size={13} className="animate-spin"/> : <BookOpenText size={13}/>}{loading ? "Buscando…" : "Consultar"}</button>
    </form>

    {!result && !loading && !error && <div className="mt-2 flex flex-wrap gap-1.5">{EXAMPLES.map((example) => (
      <button key={example} type="button" onClick={() => { setQuestion(example); ask(example); }} className="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[9px] font-bold text-slate-500 transition hover:border-blue-300 hover:text-blue-700">{example}</button>
    ))}</div>}

    {loading && <p className="mt-3 flex items-center gap-1.5 text-[10px] font-semibold text-slate-400"><Info size={11}/>La primera consulta puede tardar unos segundos (carga el buscador).</p>}

    {error && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-semibold text-amber-800">{error}</p>}

    {result && <div className="mt-3 space-y-3">
      {/* Respuesta */}
      {result.refused ? (
        <p className="flex items-start gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-[11px] font-semibold text-slate-600"><Info size={12} className="mt-0.5 shrink-0"/>{result.answer || "No encontré información suficiente sobre eso en los documentos disponibles."}</p>
      ) : (
        <>
          {result.answer && <p className="whitespace-pre-line text-xs leading-5 text-ink">{result.answer}</p>}
          {result.note && <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-[9px] font-semibold text-amber-800"><Info size={11} className="mt-0.5 shrink-0"/>{result.note === "sin_llm" ? "Redacción automática no configurada: te muestro las fuentes encontradas." : "No se pudo redactar la respuesta, pero encontré estas fuentes."}</p>}

          {result.citations.length > 0 && <div>
            <span className="text-[8px] font-extrabold uppercase tracking-wider text-slate-400">Fuentes citadas</span>
            <ul className="mt-1.5 space-y-1.5">{result.citations.map((c) => (
              <li key={c.n} className="rounded-xl border border-slate-100 bg-white p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-bold text-slate-700">
                    <span className="grid size-4 shrink-0 place-items-center rounded bg-blue-50 text-[8px] text-blue-700">{c.n}</span>
                    <FileText size={11} className="shrink-0 text-slate-400"/>
                    <span className="truncate">{c.titulo}</span>
                  </span>
                  <span className="shrink-0 text-[9px] font-semibold text-slate-400">{[c.seccion, c.pagina ? `pág. ${c.pagina}` : null].filter(Boolean).join(" · ")}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-500">“{c.fragmento}…”</p>
                {c.pdfUrl && <button type="button" onClick={() => onOpenDocument(c.documentoId, c.pagina)} className="mt-1.5 inline-flex items-center gap-1 text-[9px] font-bold text-blue-700 hover:text-blue-900"><BookOpenText size={11}/>Ver en el documento{c.pagina ? ` (pág. ${c.pagina})` : ""}</button>}
              </li>
            ))}</ul>
          </div>}
        </>
      )}

      <button type="button" onClick={() => { setResult(null); setQuestion(""); setError(null); }} className="text-[10px] font-bold text-slate-400 hover:text-blue-700">Nueva consulta</button>
    </div>}
  </section>;
}
