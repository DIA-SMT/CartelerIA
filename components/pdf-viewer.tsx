"use client";

import { ExternalLink, FileQuestion, X } from "lucide-react";
import type { UrbanDocument } from "@/data/documents";

export function PdfViewer({ document, onClose }: { document: UrbanDocument | null; onClose: () => void }) {
  if (!document) return null;
  return <div className="fixed inset-0 z-[90] flex justify-end bg-ink/35 backdrop-blur-sm" onMouseDown={onClose}><aside className="flex h-full w-full max-w-5xl flex-col bg-white shadow-2xl" onMouseDown={event => event.stopPropagation()}><header className="flex items-center justify-between gap-5 border-b border-slate-200 px-5 py-4"><div className="min-w-0"><span className="section-kicker">{document.category}</span><h2 className="truncate font-display text-lg font-extrabold text-ink">{document.title}</h2></div><div className="flex shrink-0 items-center gap-2">{document.pdfUrl && <a className="secondary-button compact" href={document.pdfUrl} target="_blank" rel="noreferrer"><ExternalLink size={15}/> Abrir aparte</a>}<button className="icon-button grid" onClick={onClose} aria-label="Cerrar visor"><X size={19}/></button></div></header>{document.pdfUrl ? <iframe className="h-full w-full bg-slate-100" src={document.pdfUrl} title={`Vista previa de ${document.title}`}/> : <div className="grid flex-1 place-items-center bg-slate-50 p-6"><div className="text-center"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-white text-slate-400 shadow-sm"><FileQuestion/></span><h3 className="mt-4 font-display font-bold text-ink">Documento no disponible para previsualización.</h3><p className="mt-1 text-sm text-slate-400">El archivo debe incorporarse dentro de public/docs.</p></div></div>}</aside></div>;
}
