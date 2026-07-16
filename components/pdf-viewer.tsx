"use client";

import { useEffect } from "react";
import { ExternalLink, FileQuestion, X } from "lucide-react";
import type { UrbanDocument } from "@/data/documents";
import { useDismissible } from "@/hooks/use-dismissible";

export function PdfViewer({ document: doc, page, onClose }: { document: UrbanDocument; page?: number | null; onClose: () => void }) {
  const { open, close } = useDismissible(onClose, 300);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // Fragmento nativo del visor PDF del navegador para abrir en una página puntual.
  const src = doc.pdfUrl ? `${doc.pdfUrl}${page ? `#page=${page}` : ""}` : null;

  return (
    <div
      className="fixed inset-0 z-[90] flex justify-end bg-ink/35 backdrop-blur-sm transition-opacity duration-300 ease-out"
      style={{ opacity: open ? 1 : 0 }}
      role="dialog"
      aria-modal="true"
      aria-label={`Visor de documento: ${doc.title}`}
      onMouseDown={close}
    >
      <aside
        className="flex h-full w-full max-w-5xl flex-col bg-white shadow-2xl transition-transform duration-300 ease-out will-change-transform"
        style={{ transform: open ? "translate3d(0,0,0)" : "translate3d(100%,0,0)" }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-5 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <span className="section-kicker">{doc.category}{page ? ` · pág. ${page}` : ""}</span>
            <h2 className="truncate font-display text-lg font-extrabold text-ink">{doc.title}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {src && <a className="secondary-button compact" href={src} target="_blank" rel="noreferrer"><ExternalLink size={15}/> Abrir aparte</a>}
            <button className="icon-button grid" onClick={close} aria-label="Cerrar visor"><X size={19}/></button>
          </div>
        </header>
        {src ? (
          <iframe key={src} className="h-full w-full bg-slate-100" src={src} title={`Vista previa de ${doc.title}`}/>
        ) : (
          <div className="grid flex-1 place-items-center bg-slate-50 p-6">
            <div className="text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-white text-slate-400 shadow-sm"><FileQuestion/></span>
              <h3 className="mt-4 font-display font-bold text-ink">Documento no disponible para previsualización.</h3>
              <p className="mt-1 text-sm text-slate-400">El archivo debe incorporarse dentro de public/docs.</p>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
