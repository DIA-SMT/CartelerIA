"use client";

import type { ReactNode } from "react";

/**
 * Carta contenedora de las consultas en lenguaje natural ("Preguntale al mapa"
 * y "Consultar normativa"). Una sola anatomía y una sola paleta (municipal)
 * para que las dos hermanas se lean como parte del mismo sistema.
 */
export function AskCard({ icon, title, subtitle, children }: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="mb-4 rounded-2xl border border-municipal-100 bg-gradient-to-br from-municipal-50/70 to-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-lg bg-municipal-600 text-white">{icon}</span>
        <div>
          <b className="text-xs text-ink">{title}</b>
          <p className="text-micro font-semibold text-slate-400">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
