"use client";

import { useState } from "react";
import { LogIn, LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { AuthPanel } from "./auth-panel";

/**
 * Indicador de sesión para el header. Autocontenido: si Supabase no está
 * configurado no muestra nada. Comparte estado con el resto de la app a través
 * de los eventos de Supabase Auth (onAuthStateChange), así que loguearse desde
 * la ficha del cartel también actualiza este indicador y viceversa.
 */
export function HeaderSession() {
  const auth = useAuth();
  const [showAuth, setShowAuth] = useState(false);

  if (!auth.available) return null;

  if (auth.loading) {
    return <span className="grid size-9 place-items-center" aria-hidden="true">
      <span className="size-4 animate-spin rounded-full border-2 border-slate-200 border-t-municipal-600" />
    </span>;
  }

  if (!auth.user) {
    return <>
      <button
        type="button"
        onClick={() => setShowAuth(true)}
        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/85 px-2.5 py-2 text-[11px] font-bold text-slate-600 transition hover:border-municipal-300 hover:text-municipal-700"
      >
        <LogIn size={15} />
        <span className="hidden sm:inline">Ingresar</span>
      </button>
      {showAuth && <AuthPanel auth={auth} onClose={() => setShowAuth(false)} />}
    </>;
  }

  const email = auth.user.email ?? "Sesión activa";

  return <div className="flex items-center gap-1.5">
    <span
      title={email}
      className="inline-flex items-center gap-1.5 rounded-xl bg-municipal-50 px-2.5 py-2 text-[11px] font-bold text-municipal-700"
    >
      <ShieldCheck size={14} />
      <span className="hidden max-w-[140px] truncate sm:inline">{email}</span>
    </span>
    <button
      type="button"
      onClick={() => void auth.signOut()}
      aria-label="Cerrar sesión"
      title="Cerrar sesión"
      className="icon-button grid"
    >
      <LogOut size={17} />
    </button>
  </div>;
}
