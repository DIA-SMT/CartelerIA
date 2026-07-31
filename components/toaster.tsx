"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Info, XCircle } from "lucide-react";

export type ToastTone = "success" | "error" | "info";

type ToastDetail = { message: string; tone: ToastTone };
type ToastItem = ToastDetail & { id: number; leaving: boolean };

const TOAST_EVENT = "carteleria:toast";
const VISIBLE_MS = 4000;
const EXIT_MS = 220;

let nextToastId = 1;

/**
 * Feedback global de acciones (guardar, aprobar, adjuntar…). Basado en eventos
 * como el resto de las señales de la app (`carteleria:*`): cualquier módulo
 * dispara `toast(...)` sin acoplar contexto; `<Toaster/>` (montado una vez en
 * el dashboard) los muestra.
 */
export function toast(message: string, tone: ToastTone = "success") {
  window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail: { message, tone } }));
}

const TONE_STYLES: Record<ToastTone, { box: string; icon: React.ReactNode }> = {
  success: { box: "border-green-200 bg-white text-green-800", icon: <CheckCircle2 size={15} className="text-green-600"/> },
  error: { box: "border-red-200 bg-white text-red-800", icon: <XCircle size={15} className="text-red-600"/> },
  info: { box: "border-slate-200 bg-white text-slate-700", icon: <Info size={15} className="text-slate-500"/> },
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const timers = new Set<number>();
    const schedule = (fn: () => void, ms: number) => {
      const timer = window.setTimeout(() => { timers.delete(timer); fn(); }, ms);
      timers.add(timer);
    };
    const onToast = (event: Event) => {
      const { message, tone } = (event as CustomEvent<ToastDetail>).detail;
      const id = nextToastId++;
      setItems((current) => [...current, { id, message, tone, leaving: false }]);
      schedule(() => setItems((current) => current.map((item) => item.id === id ? { ...item, leaving: true } : item)), VISIBLE_MS);
      schedule(() => setItems((current) => current.filter((item) => item.id !== id)), VISIBLE_MS + EXIT_MS);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-5 z-[1400] flex flex-col items-center gap-2 px-4">
      {items.map((item) => (
        <div
          key={item.id}
          data-state={item.leaving ? "closed" : "open"}
          className={`pointer-events-auto flex max-w-full items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-bold shadow-lg transition-[transform,opacity] duration-200 ease-spring will-change-transform animate-scale-in data-[state=closed]:translate-y-2 data-[state=closed]:opacity-0 ${TONE_STYLES[item.tone].box}`}
        >
          {TONE_STYLES[item.tone].icon}
          <span className="min-w-0">{item.message}</span>
        </div>
      ))}
    </div>
  );
}
