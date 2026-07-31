"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpenText, FileText, Info, Loader2, Lock, Scale, Search, X } from "lucide-react";
import type { NormativaResponse } from "@/data/normativa";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";

type Props = {
  onOpenDocument: (documentoId: string, page: number | null) => void;
};

const EXAMPLES = [
  "¿Qué problemas genera la cartelería sin control?",
  "¿Qué proponen para ordenar la cartelería?",
  "¿Qué son los corredores publicitarios?",
];

const NOTE_MESSAGES: Record<NonNullable<NormativaResponse["note"]>, string> = {
  sin_llm: "La redacción externa está habilitada pero no configurada; te muestro las fuentes recuperadas.",
  ia_externa_desactivada: "La redacción externa está desactivada; te muestro las fuentes recuperadas localmente.",
  fuente_restringida: "La fuente es interna, no fue revisada o no está autorizada para salir del entorno municipal. Te muestro la recuperación local.",
  pii_detectada: "Por privacidad, el contenido no se envió a un proveedor externo. Te muestro las fuentes recuperadas.",
  llm_error: "No se pudo redactar la respuesta, pero la recuperación documental sí encontró estas fuentes.",
  llm_refused: "El proveedor externo no produjo una respuesta útil; se conservan las fuentes recuperadas.",
  citas_invalidas: "La redacción externa se descartó porque sus citas no eran verificables. Se conservan las fuentes.",
  revision_humana_requerida: "Se muestran coincidencias documentales, no una conclusión jurídica. Las fuentes todavía requieren revisión humana.",
};

export function NormativaAsk({ onOpenDocument }: Props) {
  const auth = useAuth();
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<NormativaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    requestSequence.current += 1;
    setQuestion("");
    setLoading(false);
    setResult(null);
    setError(null);
  }, [auth.user?.id]);

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading || !auth.canRead || !auth.user || !supabase) return;
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session || session.user.id !== auth.user.id) {
        setError("No se pudo verificar tu sesión municipal.");
        return;
      }
      const response = await fetch("/api/normativa", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question: trimmed }),
      });
      if (sequence !== requestSequence.current) return;
      if (response.status === 501) {
        setError("El asistente de normativa no está configurado en este entorno.");
        return;
      }
      if (response.status === 401 || response.status === 403) {
        setError("La consulta requiere una cuenta municipal con perfil habilitado.");
        return;
      }
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        setError(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? `Alcanzaste el límite de consultas. Reintentá en ${Math.ceil(retryAfter)} segundos.`
            : "Alcanzaste el límite de consultas. Reintentá en un minuto.",
        );
        return;
      }
      if (!response.ok) {
        setError("No se pudo consultar la normativa. Reintentá en un momento.");
        return;
      }
      setResult((await response.json()) as NormativaResponse);
    } catch {
      if (sequence === requestSequence.current) {
        setError("No se pudo consultar la normativa. Verificá tu conexión.");
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  };

  return <section aria-label="Consultar normativa" className="mb-6 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50/70 to-white p-4 shadow-sm">
    <div className="flex items-center gap-2">
      <span className="grid size-7 place-items-center rounded-lg bg-blue-600 text-white"><Scale size={14}/></span>
      <div>
        <b className="text-xs text-ink">Consultar normativa</b>
        <p className="text-[9px] font-semibold text-slate-400">Busca coincidencias en el corpus municipal y muestra su procedencia. No emite una conclusión jurídica automática.</p>
      </div>
    </div>

    {!auth.canRead ? (
      <div className="mt-3 rounded-xl bg-slate-100 p-3 text-[10px] font-semibold text-slate-600">
        <p className="flex items-start gap-1.5"><Lock size={12} className="mt-0.5 shrink-0"/>{auth.user ? auth.roleError || "Verificando permisos municipales…" : "Ingresá con tu cuenta municipal para consultar el corpus interno."}</p>
        {auth.user && auth.roleError && <button type="button" onClick={() => void auth.retryRole()} className="secondary-button compact mt-2">Reintentar permisos</button>}
      </div>
    ) : <>
    <form onSubmit={(event) => { event.preventDefault(); ask(question); }} className="mt-3 flex items-center gap-2">
      <div className="flex flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
        <Search size={14} className="shrink-0 text-slate-400"/>
        <input value={question} maxLength={500} onChange={(event) => setQuestion(event.target.value)} placeholder="Ej: ¿qué dice la normativa sobre la contaminación visual?" className="min-w-0 flex-1 bg-transparent text-[11px] font-semibold text-slate-700 outline-none placeholder:text-slate-400"/>
        {question && <button type="button" onClick={() => { setQuestion(""); setResult(null); setError(null); }} aria-label="Limpiar" className="text-slate-400 hover:text-blue-700"><X size={13}/></button>}
      </div>
      <button type="submit" disabled={loading || !question.trim()} className="primary-button compact justify-center disabled:cursor-not-allowed disabled:opacity-60">{loading ? <Loader2 size={13} className="animate-spin"/> : <BookOpenText size={13}/>}{loading ? "Buscando…" : "Consultar"}</button>
    </form>

    {!result && !loading && !error && <div className="mt-2 flex flex-wrap gap-1.5">{EXAMPLES.map((example) => (
      <button key={example} type="button" onClick={() => { setQuestion(example); ask(example); }} className="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[9px] font-bold text-slate-500 transition hover:border-blue-300 hover:text-blue-700">{example}</button>
    ))}</div>}

    {loading && <p className="mt-3 flex items-center gap-1.5 text-[10px] font-semibold text-slate-400"><Info size={11}/>Buscando coincidencias dentro del corpus municipal privado.</p>}

    {error && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-semibold text-amber-800">{error}</p>}

    {result && <div className="mt-3 space-y-3">
      {/* Respuesta */}
      {result.refused ? (
        <p className="flex items-start gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-[11px] font-semibold text-slate-600"><Info size={12} className="mt-0.5 shrink-0"/>{result.answer || "No encontré información suficiente sobre eso en los documentos disponibles."}</p>
      ) : (
        <>
          {result.answer && <p className="whitespace-pre-line text-xs leading-5 text-ink">{result.answer}</p>}
          {result.note && <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-[9px] font-semibold text-amber-800"><Info size={11} className="mt-0.5 shrink-0"/>{NOTE_MESSAGES[result.note]}</p>}

          {result.citations.length > 0 && <div>
            <span className="text-[8px] font-extrabold uppercase tracking-wider text-slate-400">{result.answer ? "Fuentes citadas" : "Fuentes recuperadas"}</span>
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
                <p className={`mt-1 text-[8px] font-bold ${c.legalUseReady ? "text-green-700" : "text-amber-700"}`}>{c.legalUseReady ? "Fuente revisada y con huellas de PDF/texto" : "Borrador documental: requiere revisión humana"}{c.sourcePdfHash ? ` · PDF ${c.sourcePdfHash.slice(0, 12)}…` : ""}{c.contenidoHash ? ` · texto ${c.contenidoHash.slice(0, 12)}…` : ""}</p>
                {c.pdfUrl && <button type="button" onClick={() => onOpenDocument(c.documentoId, c.pagina)} className="mt-1.5 inline-flex items-center gap-1 text-[9px] font-bold text-blue-700 hover:text-blue-900"><BookOpenText size={11}/>Ver en el documento{c.pagina ? ` (pág. ${c.pagina})` : ""}</button>}
              </li>
            ))}</ul>
          </div>}
        </>
      )}

      <button type="button" onClick={() => { setResult(null); setQuestion(""); setError(null); }} className="text-[10px] font-bold text-slate-400 hover:text-blue-700">Nueva consulta</button>
    </div>}
    </>}
  </section>;
}
