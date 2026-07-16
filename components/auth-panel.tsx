"use client";

import { useEffect, useId, useState } from "react";
import { LogIn, ShieldCheck, X } from "lucide-react";
import type { AuthState } from "@/hooks/use-auth";
import { useDismissible } from "@/hooks/use-dismissible";

type Props = {
  auth: AuthState;
  onClose: () => void;
};

/**
 * Modal de inicio de sesión. Es opcional: la vista pública del mapa y los
 * documentos sigue funcionando sin sesión. Solo desbloquea las inspecciones.
 */
export function AuthPanel({ auth, onClose }: Props) {
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { open, close } = useDismissible(onClose);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    const ok = await auth.signIn(email, password);
    setSubmitting(false);
    if (ok) close();
  };

  return (
    <div
      className="fixed inset-0 z-[1000] grid place-items-center bg-ink/40 p-4 backdrop-blur-sm transition-opacity duration-200 ease-out"
      style={{ opacity: open ? 1 : 0 }}
      role="presentation"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${emailId}-title`}
        className="w-full max-w-sm rounded-2xl border border-white bg-white p-6 shadow-2xl transition-[transform,opacity] duration-200 ease-spring will-change-transform"
        style={{ opacity: open ? 1 : 0, transform: open ? "translate3d(0,0,0) scale(1)" : "translate3d(0,8px,0) scale(.96)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <span className="grid size-11 place-items-center rounded-xl bg-municipal-50 text-municipal-700">
            <ShieldCheck size={20} />
          </span>
          <button onClick={onClose} className="icon-button grid" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <h2 id={`${emailId}-title`} className="mt-4 font-display text-lg font-extrabold text-ink">
          Acceso operativo
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Ingresá con tu cuenta municipal para registrar inspecciones.
        </p>

        {!auth.available && (
          <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700">
            La autenticación no está configurada en este entorno.
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <div>
            <label htmlFor={emailId} className="detail-title">
              Correo
            </label>
            <div className="filter-input mt-1.5">
              <input
                id={emailId}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="usuario@smt.gob.ar"
              />
            </div>
          </div>

          <div>
            <label htmlFor={passwordId} className="detail-title">
              Contraseña
            </label>
            <div className="filter-input mt-1.5">
              <input
                id={passwordId}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
              />
            </div>
          </div>

          {auth.error && (
            <p role="alert" className="text-[11px] font-semibold text-red-600">
              {auth.error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !auth.available}
            className="primary-button w-full justify-center disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LogIn size={15} />
            {submitting ? "Ingresando…" : "Ingresar"}
          </button>
        </form>
      </div>
    </div>
  );
}
