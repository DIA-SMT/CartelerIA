"use client";

import { useState } from "react";
import { ArrowRight, Info, ListFilter, Loader2, Lock, MapPinned, RotateCcw, Send, Sparkles, X } from "lucide-react";
import type { AnalyzedCartel, TerritorialFilterState } from "@/data/territorial";
import { initialTerritorialFilters } from "@/data/territorial";
import type { Predicate, QueryIntent } from "@/data/map-query";
import {
  buildAnswer,
  intentToFilterState,
  predicateChips,
  removeChip,
  runQuery,
  type QueryResult,
} from "@/lib/map-query-engine";
import {
  buildInspectionAnswer,
  runInspectionQuery,
  type InspectionQueryResult,
} from "@/lib/inspection-query-engine";
import { loadInspections, type InspectionRecord } from "@/lib/inspection-repository";
import { interpretQuestionSmart, type InterpretSource } from "@/lib/map-query-ai";
import { useAuth } from "@/hooks/use-auth";

type Props = {
  carteles: AnalyzedCartel[];
  onApply: (filters: TerritorialFilterState) => void;
};

const EXAMPLES = [
  "¿Cuántos están fuera de zona?",
  "Carteles riesgosos cerca de zonas sensibles",
  "Pantallas LED con deuda",
  "¿Qué empresa tiene más observaciones?",
];

const OPERATION_LABEL: Record<QueryIntent["operation"], string> = {
  count: "Conteo",
  list: "Listado",
  aggregate: "Ranking",
};

export function MapAsk({ carteles, onApply }: Props) {
  const auth = useAuth();
  const canReadInspecciones = auth.available && Boolean(auth.user);

  const [question, setQuestion] = useState("");
  const [intent, setIntent] = useState<QueryIntent | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [inspResult, setInspResult] = useState<InspectionQueryResult | null>(null);
  const [inspRecords, setInspRecords] = useState<InspectionRecord[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<InterpretSource | null>(null);

  const reset = () => {
    setIntent(null);
    setResult(null);
    setInspResult(null);
    setInspRecords([]);
    setNotice(null);
    setSource(null);
  };

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    try {
      const { intent: parsed, source: usedSource } = await interpretQuestionSmart(trimmed);

      if (parsed.dataset === "inspecciones") {
        setResult(null);
        if (!canReadInspecciones) {
          setNotice(
            auth.available
              ? "Ingresá con tu cuenta municipal para consultar inspecciones."
              : "Las inspecciones no están disponibles en este entorno.",
          );
          setInspResult(null);
          setInspRecords([]);
        } else {
          const records = await loadInspections();
          setInspRecords(records);
          setInspResult(runInspectionQuery(parsed, records));
          setNotice(null);
        }
      } else {
        setInspResult(null);
        setNotice(null);
        setResult(runQuery(parsed, carteles));
      }

      setIntent(parsed);
      setSource(usedSource);
    } finally {
      setLoading(false);
    }
  };

  // La corrección de chips es determinista (no vuelve a llamar a la IA).
  const reRun = (nextPredicate: Predicate | undefined, base: QueryIntent) => {
    const next: QueryIntent = { ...base, predicate: nextPredicate };
    setIntent(next);
    if (next.dataset === "inspecciones") setInspResult(runInspectionQuery(next, inspRecords));
    else setResult(runQuery(next, carteles));
  };

  const isInsp = intent?.dataset === "inspecciones";
  const chips = intent ? predicateChips(intent.predicate) : null;
  const groups = isInsp ? inspResult?.groups ?? [] : result?.groups ?? [];

  return <section aria-label="Preguntale al mapa" className="mb-4 rounded-2xl border border-municipal-200 bg-gradient-to-br from-municipal-50/70 to-white p-4 shadow-sm">
    <div className="flex items-center gap-2">
      <span className="grid size-7 place-items-center rounded-lg bg-municipal-600 text-white"><Sparkles size={14}/></span>
      <div><b className="text-xs text-ink">Preguntale al mapa</b><p className="text-[9px] font-semibold text-slate-400">Consultá en lenguaje natural. El conteo sale de los datos reales, no de una estimación.</p></div>
    </div>

    <form onSubmit={(event) => { event.preventDefault(); ask(question); }} className="mt-3 flex items-center gap-2">
      <div className="flex flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 focus-within:border-municipal-400 focus-within:ring-2 focus-within:ring-municipal-100">
        <ListFilter size={14} className="shrink-0 text-slate-400"/>
        <input value={question} maxLength={500} onChange={(event) => setQuestion(event.target.value)} placeholder="Ej: carteles fuera de zona con deuda" className="min-w-0 flex-1 bg-transparent text-[11px] font-semibold text-slate-700 outline-none placeholder:text-slate-400"/>
        {question && <button type="button" onClick={() => { setQuestion(""); reset(); }} aria-label="Limpiar" className="text-slate-400 hover:text-municipal-700"><X size={13}/></button>}
      </div>
      <button type="submit" disabled={loading || !question.trim()} className="primary-button compact justify-center disabled:cursor-not-allowed disabled:opacity-60">{loading ? <Loader2 size={13} className="animate-spin"/> : <Send size={13}/>}{loading ? "Consultando…" : "Preguntar"}</button>
    </form>

    {!intent && <div className="mt-2 flex flex-wrap gap-1.5">{EXAMPLES.map((example) => (
      <button key={example} type="button" onClick={() => { setQuestion(example); ask(example); }} className="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[9px] font-bold text-slate-500 transition hover:border-municipal-300 hover:text-municipal-700">{example}</button>
    ))}</div>}

    {intent && <div className="mt-3 space-y-3">
      {/* Cómo lo interpretó */}
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[8px] font-extrabold uppercase tracking-wider text-slate-400">
            Así lo interpreté
            {source === "ai" && <span className="inline-flex items-center gap-0.5 rounded-md bg-municipal-600 px-1.5 py-0.5 text-white"><Sparkles size={8}/>IA</span>}
            {source === "rules" && <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-slate-500">Reglas</span>}
            {isInsp && <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-blue-700">Inspecciones</span>}
          </span>
          <span className="rounded-md bg-municipal-50 px-1.5 py-0.5 text-[8px] font-extrabold uppercase text-municipal-700">{OPERATION_LABEL[intent.operation]}</span>
        </div>
        {chips === null ? (
          <p className="mt-1.5 text-[10px] text-slate-500">{intent.explanation}</p>
        ) : chips.length === 0 ? (
          <p className="mt-1.5 text-[10px] text-slate-500">Sin filtros.</p>
        ) : (
          <div className="mt-1.5 flex flex-wrap gap-1">{chips.map((chip) => (
            <span key={chip.leafIndex} className="inline-flex items-center gap-1 rounded-full bg-municipal-50 px-2 py-1 text-[9px] font-bold text-municipal-700">
              {chip.label}
              <button type="button" onClick={() => reRun(removeChip(intent.predicate, chip.leafIndex), intent)} aria-label={`Quitar ${chip.label}`} className="text-municipal-400 hover:text-municipal-700"><X size={9}/></button>
            </span>
          ))}</div>
        )}
        {intent.unsupported.length > 0 && <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-[9px] font-semibold text-amber-800"><Info size={11} className="mt-0.5 shrink-0"/>No pude filtrar por: {intent.unsupported.join(", ")}.</p>}
      </div>

      {/* Aviso (auth requerida / no disponible) */}
      {notice && <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-semibold text-amber-800"><Lock size={12} className="mt-0.5 shrink-0"/>{notice}</p>}

      {/* Respuesta exacta */}
      {!notice && isInsp && inspResult && <p className="text-xs font-bold text-ink">{buildInspectionAnswer(intent, inspResult)}</p>}
      {!notice && !isInsp && result && <p className="text-xs font-bold text-ink">{buildAnswer(intent, result)}</p>}

      {/* Ranking (aggregate) — ambos datasets */}
      {!notice && intent.operation === "aggregate" && groups.length > 0 && <ul className="space-y-1">{groups.map((group) => (
        <li key={group.key}>
          <button type="button" onClick={() => reRun({ field: intent.aggregate!.groupBy, op: "eq", value: group.key }, { ...intent, operation: "list", applyToMap: !isInsp, aggregate: undefined })} className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-100 bg-white px-2.5 py-1.5 text-[10px] hover:border-municipal-300">
            <span className="truncate font-bold text-slate-700">{group.label}</span>
            <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-extrabold text-slate-600">{group.count}</span>
          </button>
        </li>
      ))}</ul>}

      {/* Muestra de resultados (list, solo carteles) */}
      {!notice && !isInsp && result && intent.operation !== "aggregate" && result.count > 0 && <ul className="space-y-1">{result.items.slice(0, 6).map((item) => (
        <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-white px-2.5 py-1.5 text-[10px]">
          <span className="truncate font-semibold text-slate-600">{item.name}</span>
          {item.empresa && <span className="shrink-0 truncate text-[9px] text-slate-400">{item.empresa}</span>}
        </li>
      ))}{result.count > 6 && <li className="px-1 text-[9px] font-semibold text-slate-400">y {result.count - 6} más…</li>}</ul>}

      {/* Acciones */}
      <div className="flex flex-wrap gap-2">
        {!isInsp && result && result.count > 0 && intent.operation !== "aggregate" && <button type="button" onClick={() => onApply(intentToFilterState(intent, carteles))} className="secondary-button compact justify-center"><MapPinned size={12}/>Ver en el mapa ({result.count})</button>}
        {!isInsp && <button type="button" onClick={() => onApply(initialTerritorialFilters)} className="secondary-button compact justify-center"><RotateCcw size={12}/>Limpiar mapa</button>}
        <button type="button" onClick={() => { setQuestion(""); reset(); }} className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-municipal-700"><ArrowRight size={12}/>Nueva consulta</button>
      </div>
    </div>}
  </section>;
}
