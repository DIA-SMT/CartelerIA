"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Compass, X } from "lucide-react";
import { TOUR_EVENT, TOUR_STEPS, TOUR_STORAGE_KEY } from "@/data/tour";

const CARD_MARGIN = 12;

type Rect = { top: number; left: number; width: number; height: number };
type Pos = { top: number; left: number };

function getRect(selector: string | null): Rect | null {
  if (!selector || typeof document === "undefined") return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/**
 * Tour de bienvenida guiado, sin dependencias. Se auto-inicia una sola vez
 * (localStorage) y se puede relanzar con el evento TOUR_EVENT.
 */
export function ProductTour() {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const step = TOUR_STEPS[index];
  const isFirst = index === 0;
  const isLast = index === TOUR_STEPS.length - 1;

  const finish = useCallback(() => {
    setActive(false);
    setPos(null);
    setRect(null);
    try {
      window.localStorage.setItem(TOUR_STORAGE_KEY, "1");
    } catch {
      /* almacenamiento no disponible: no pasa nada */
    }
  }, []);

  const start = useCallback(() => {
    setIndex(0);
    setRect(null);
    setPos(null);
    setActive(true);
  }, []);

  // Auto-inicio en la primera visita + relanzamiento por evento.
  useEffect(() => {
    const onEvent = () => start();
    window.addEventListener(TOUR_EVENT, onEvent);

    let seen = "1";
    try {
      seen = window.localStorage.getItem(TOUR_STORAGE_KEY) ?? "";
    } catch {
      seen = "1";
    }
    let timer: number | undefined;
    if (!seen) timer = window.setTimeout(start, 1100);

    return () => {
      window.removeEventListener(TOUR_EVENT, onEvent);
      if (timer) window.clearTimeout(timer);
    };
  }, [start]);

  // Mientras el tour está abierto, forzar scroll instantáneo: el proyecto usa
  // scroll-behavior: smooth, que animaría cada salto ~1.5s y desalinearía el
  // spotlight hasta que la animación termine.
  useEffect(() => {
    if (!active) return;
    const html = document.documentElement;
    const previous = html.style.scrollBehavior;
    html.style.scrollBehavior = "auto";
    return () => { html.style.scrollBehavior = previous; };
  }, [active]);

  // Al cambiar de paso: llevar el objetivo al centro (scroll instantáneo).
  // No se resetea `pos` acá: el useLayoutEffect de más abajo es el único dueño de
  // la posición. Hacerlo generaba un race (este useEffect corría DESPUÉS del
  // layout effect y dejaba pos=null → tarjeta invisible y overlay que bloquea todo).
  useEffect(() => {
    if (!active) return;
    if (step.selector) {
      document.querySelector(step.selector)?.scrollIntoView({ behavior: "auto", block: "center" });
    }
  }, [active, index, step.selector]);

  // Trackear el objetivo para mantener el spotlight alineado (el overlay es fixed,
  // en coordenadas de viewport). Se mide con requestAnimationFrame acotado por
  // TIEMPO: al menos ~2.5s y hasta 700ms después del último cambio, así captura
  // reflows tardíos (ej. el mapa Leaflet que monta después) y luego se detiene
  // (la página queda idle, no consume CPU). Scroll o resize reactivan el track.
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = "";
    let until = performance.now() + 2500;
    const loop = () => {
      const r = getRect(step.selector);
      const key = r ? `${Math.round(r.top)},${Math.round(r.left)},${Math.round(r.width)},${Math.round(r.height)}` : "null";
      if (key !== last) { last = key; until = performance.now() + 700; setRect(r); }
      raf = performance.now() < until ? requestAnimationFrame(loop) : 0;
    };
    const restart = () => { until = performance.now() + 700; if (!raf) raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    window.addEventListener("scroll", restart, true);
    window.addEventListener("resize", restart);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", restart, true);
      window.removeEventListener("resize", restart);
    };
  }, [active, step.selector, index]);

  // Calcular la posición de la tarjeta una vez medido el objetivo.
  useLayoutEffect(() => {
    if (!active) return;
    const card = cardRef.current;
    if (!card) return;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const isMobile = vw < 640;

    if (!rect) {
      setPos({ top: Math.max(CARD_MARGIN, (vh - ch) / 2), left: Math.max(CARD_MARGIN, (vw - cw) / 2) });
      return;
    }
    if (isMobile) {
      setPos({ top: vh - ch - 16, left: Math.max(CARD_MARGIN, (vw - cw) / 2) });
      return;
    }
    let top = rect.top + rect.height + CARD_MARGIN;
    if (top + ch > vh - CARD_MARGIN) {
      const above = rect.top - ch - CARD_MARGIN;
      top = above >= CARD_MARGIN ? above : Math.max(CARD_MARGIN, (vh - ch) / 2);
    }
    let left = rect.left + rect.width / 2 - cw / 2;
    left = Math.min(Math.max(CARD_MARGIN, left), vw - cw - CARD_MARGIN);
    setPos({ top, left });
  }, [active, rect, index]);

  const next = useCallback(() => {
    if (isLast) finish();
    else setIndex((i) => Math.min(i + 1, TOUR_STEPS.length - 1));
  }, [isLast, finish]);
  const prev = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);

  // Teclado.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); finish(); }
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, next, prev, finish]);

  if (!active) return null;

  const visible = pos !== null;

  return (
    <div className="fixed inset-0 z-[2000]" role="dialog" aria-modal="true" aria-label="Recorrido guiado" onClick={finish}>
      {/* Capa oscura: con "hueco" sobre el objetivo, o dim completo si es centrado. */}
      {rect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-2xl ring-2 ring-white/80 transition-all duration-300"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.55)",
          }}
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-ink/55" />
      )}

      {/* Tarjeta */}
      <div
        ref={cardRef}
        onClick={(event) => event.stopPropagation()}
        className="absolute w-[min(360px,calc(100vw-1.5rem))] rounded-2xl border border-white bg-white p-5 shadow-2xl transition-[top,left] duration-200"
        style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, opacity: visible ? 1 : 0 }}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-municipal-50 text-municipal-700">
            <Compass size={18} />
          </span>
          <button onClick={finish} className="icon-button grid" aria-label="Saltar recorrido">
            <X size={17} />
          </button>
        </div>

        <h2 className="mt-3 font-display text-base font-extrabold text-ink">{step.title}</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">{step.body}</p>

        <div className="mt-4 flex items-center gap-1.5" aria-hidden="true">
          {TOUR_STEPS.map((s, i) => (
            <span
              key={s.id}
              className={`h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-municipal-600" : "w-1.5 bg-slate-200"}`}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-[11px] font-bold text-slate-400">
            {index + 1} / {TOUR_STEPS.length}
          </span>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <button onClick={prev} className="secondary-button compact">
                <ArrowLeft size={15} />Anterior
              </button>
            )}
            <button onClick={next} className="primary-button compact">
              {isLast ? <>Finalizar<Check size={15} /></> : <>Siguiente<ArrowRight size={15} /></>}
            </button>
          </div>
        </div>

        {!isLast && (
          <button onClick={finish} className="mt-3 block w-full text-center text-[11px] font-bold text-slate-400 hover:text-municipal-700">
            Saltar recorrido
          </button>
        )}
      </div>
    </div>
  );
}
