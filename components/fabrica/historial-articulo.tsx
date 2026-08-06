"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useDismissible } from "@/hooks/use-dismissible";
import { useModalShell } from "@/hooks/use-modal-shell";
import {
  ORIGEN_ARTICULO_LABELS,
  loadVersiones,
  type ArticuloNorma,
  type VersionArticulo,
} from "@/lib/fabrica-repository";
import { confirmDialogIsOpen } from "../confirm-dialog";

/**
 * Historial de un artículo, con comparación lado a lado.
 *
 * Lo que se compara por omisión es el texto vigente contra el del borrador
 * recibido, no contra la versión inmediata anterior: la pregunta que aparece
 * cuando alguien discute un artículo es "¿qué decía originalmente?", no "¿qué
 * decía hace dos guardados?".
 */
export function HistorialArticulo({
  articulo,
  onClose,
}: {
  articulo: ArticuloNorma;
  onClose: () => void;
}) {
  const { open, close } = useDismissible(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalShell(panelRef);
  const [versiones, setVersiones] = useState<VersionArticulo[]>([]);
  const [comparar, setComparar] = useState<VersionArticulo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadVersiones(articulo.id).then((result) => {
      if (!active) return;
      setVersiones(result.data);
      setError(result.ok ? null : result.error);
      setLoading(false);
    });
    return () => { active = false; };
  }, [articulo.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || confirmDialogIsOpen()) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const izquierda = comparar
    ? { titulo: `Versión ${comparar.version}`, texto: comparar.texto }
    : { titulo: "Texto del borrador recibido", texto: articulo.textoOriginal ?? "Sin texto original: este artículo se redactó desde cero." };

  return (
    <div
      className="fixed inset-0 z-[1100] grid place-items-center bg-ink/45 p-4 backdrop-blur-sm transition-opacity duration-200 ease-out"
      style={{ opacity: open ? 1 : 0 }}
      role="presentation"
      onClick={close}
      data-state={open ? "open" : "closed"}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Historial del artículo ${articulo.numero ?? articulo.orden}`}
        className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-2xl border border-white bg-white p-5 shadow-2xl transition-[transform,opacity] duration-200 ease-spring will-change-transform"
        style={{ opacity: open ? 1 : 0, transform: open ? "translate3d(0,0,0) scale(1)" : "translate3d(0,8px,0) scale(.96)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3">
          <div>
            <span className="micro-label">Historial</span>
            <h2 className="font-display text-base font-extrabold text-ink">
              Artículo {articulo.numero ?? articulo.orden}
              {articulo.sumilla ? ` · ${articulo.sumilla}` : ""}
            </h2>
          </div>
          <button type="button" onClick={close} aria-label="Cerrar" className="secondary-button compact"><X size={14}/></button>
        </div>

        <div className="mt-4 grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
          {/* Comparación */}
          <div className="flex min-h-0 flex-col gap-2">
            <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <span className="micro-label shrink-0">{izquierda.titulo}</span>
              <p className="mt-1.5 flex-1 overflow-y-auto whitespace-pre-wrap text-tiny leading-5 text-slate-600">
                {izquierda.texto}
              </p>
            </div>
            <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-municipal-200 bg-municipal-50/40 p-3">
              <span className="micro-label shrink-0">Texto vigente</span>
              <p className="mt-1.5 flex-1 overflow-y-auto whitespace-pre-wrap text-tiny leading-5 text-slate-700">
                {articulo.texto}
              </p>
            </div>
          </div>

          {/* Línea de tiempo */}
          <div className="min-h-0 overflow-y-auto">
            {loading ? (
              <div className="space-y-2">
                <div className="skeleton h-16 rounded-xl"/>
                <div className="skeleton h-16 rounded-xl"/>
              </div>
            ) : error ? (
              <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-tiny font-semibold text-red-800">{error}</p>
            ) : (
              <ol className="space-y-2">
                {versiones.map((version) => {
                  const activa = comparar?.id === version.id;
                  return (
                    <li key={version.id}>
                      <button
                        type="button"
                        onClick={() => setComparar(activa ? null : version)}
                        className={`w-full rounded-xl border p-3 text-left transition duration-fast ${
                          activa
                            ? "border-municipal-300 bg-municipal-50"
                            : "border-slate-100 bg-white hover:border-municipal-200"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <b className="text-tiny text-ink">Versión {version.version}</b>
                          <span className="badge-soft shrink-0">
                            <i style={{ background: version.origen === "asistente" ? "#6366f1" : "#64748b" }}/>
                            {ORIGEN_ARTICULO_LABELS[version.origen]}
                          </span>
                        </div>
                        {version.motivo && (
                          <p className="mt-1 text-micro leading-4 text-slate-600">{version.motivo}</p>
                        )}
                        <p className="mt-1 text-micro text-slate-400">
                          {[version.autorRol, new Date(version.creadoEn).toLocaleString("es-AR")]
                            .filter(Boolean).join(" · ")}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
            <p className="mt-3 text-micro leading-4 text-slate-400">
              Tocá una versión para compararla contra el texto vigente. Sin selección se
              muestra el borrador original.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
