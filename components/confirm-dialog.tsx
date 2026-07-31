"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useDismissible } from "@/hooks/use-dismissible";
import { useModalShell } from "@/hooks/use-modal-shell";

type Tone = "approve" | "reject" | "discard";

type Props = {
  title: string;
  description: string;
  /** Texto tipeado por el usuario (fundamento) que la decisión va a asentar. */
  quote?: string | null;
  tone: Tone;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Overlays padres que escuchan Esc en fase capture (se registraron antes que
 * este diálogo) deben ceder mientras haya una confirmación abierta:
 * `if (confirmDialogIsOpen()) return;` en su handler.
 */
let openDialogCount = 0;
export function confirmDialogIsOpen(): boolean {
  return openDialogCount > 0;
}

const TONE_STYLES: Record<Tone, { icon: React.ReactNode; chip: string; confirm: string }> = {
  approve: {
    icon: <CheckCircle2 size={20} />,
    chip: "bg-green-50 text-green-700",
    confirm: "bg-green-700 text-white hover:bg-green-800 focus-visible:ring-green-600",
  },
  reject: {
    icon: <XCircle size={20} />,
    chip: "bg-red-50 text-red-700",
    confirm: "bg-red-700 text-white hover:bg-red-800 focus-visible:ring-red-600",
  },
  discard: {
    icon: <AlertTriangle size={20} />,
    chip: "bg-amber-50 text-amber-700",
    confirm: "bg-red-700 text-white hover:bg-red-800 focus-visible:ring-red-600",
  },
};

/**
 * Reemplazo propio de window.confirm para decisiones administrativas: muestra
 * qué se va a resolver y con qué fundamento, con jerarquía visual y teclado.
 * El foco inicial cae en "Cancelar" (default seguro).
 */
export function ConfirmDialog({ title, description, quote, tone, confirmLabel, cancelLabel = "Cancelar", onConfirm, onCancel }: Props) {
  const { open, close } = useDismissible(onCancel);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalShell(dialogRef);
  const styles = TONE_STYLES[tone];

  useEffect(() => {
    openDialogCount += 1;
    return () => { openDialogCount -= 1; };
  }, []);

  useEffect(() => {
    // Capture + stopPropagation: se abre encima de otros overlays; el Esc es
    // de este diálogo (los padres deben ignorar Esc mientras confirman).
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close]);

  return (
    <div
      className="fixed inset-0 z-[1200] grid place-items-center bg-ink/45 p-4 backdrop-blur-sm transition-opacity duration-200 ease-out"
      style={{ opacity: open ? 1 : 0 }}
      role="presentation"
      onClick={close}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-2xl border border-white bg-white p-5 shadow-2xl transition-[transform,opacity] duration-200 ease-spring will-change-transform"
        style={{ opacity: open ? 1 : 0, transform: open ? "translate3d(0,0,0) scale(1)" : "translate3d(0,8px,0) scale(.96)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <span className={`grid size-11 place-items-center rounded-xl ${styles.chip}`}>{styles.icon}</span>
        <h2 className="mt-3 font-display text-base font-extrabold text-ink">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        {quote && (
          <blockquote className="mt-3 rounded-xl border-l-2 border-slate-300 bg-slate-50 px-3 py-2 text-tiny leading-4 text-slate-600">
            “{quote}”
          </blockquote>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" autoFocus onClick={close} className="secondary-button compact">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl px-4 text-xs font-bold shadow-sm transition ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${styles.confirm}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
