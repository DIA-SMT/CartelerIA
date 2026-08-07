"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import { useDismissible } from "@/hooks/use-dismissible";
import { useModalShell } from "@/hooks/use-modal-shell";
import type { ArticuloNorma, ProyectoNorma } from "@/lib/fabrica-repository";
import { ensamblarArticulado, nombreDocumento, pieDelDocumento } from "@/lib/norma-export";

interface PropsArticulado {
  proyecto: ProyectoNorma;
  articulos: ArticuloNorma[];
  onClose: () => void;
}

/**
 * El panel real no se monta hasta tener `document.body`, y la espera va acá
 * afuera a propósito: `useModalShell` lee su ref una sola vez, al montarse. Si
 * el primer render devolviera `null` con el hook ya llamado, el ref estaría
 * vacío y el bloqueo de scroll, el focus trap y la restitución de foco no se
 * engancharían nunca. Es el mismo orden que usa el cajón lateral.
 */
export function ArticuladoCompleto(props: PropsArticulado) {
  const [montado, setMontado] = useState(false);
  useEffect(() => { setMontado(true); }, []);
  if (!montado) return null;
  return <PanelArticulado {...props}/>;
}

/**
 * El documento completo, ensamblado y listo para imprimir.
 *
 * Una sola salida: PDF, desde la vista para imprimir. El membrete se resuelve
 * en CSS `@media print` y cualquiera guarda como PDF desde el navegador. Meter
 * un navegador headless en una función serverless sería la dependencia más
 * pesada y frágil del proyecto para conseguir lo mismo.
 *
 * El panel va por `createPortal` a `document.body`, y para el PDF eso no es
 * cosmético: la regla de impresión apaga a los hermanos directos de `body`, así
 * que montado dentro del árbol del tablero se imprimía la página entera —mapa,
 * tablas y todo— con el documento en el medio.
 */
function PanelArticulado({ proyecto, articulos, onClose }: PropsArticulado) {
  const { open, close } = useDismissible(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalShell(panelRef);

  const ensamblado = ensamblarArticulado(articulos);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  /**
   * El navegador nombra el PDF con `document.title` y lo imprime en su propio
   * encabezado. Sin esto el archivo sale llamándose como la aplicación, que no
   * dice qué documento es.
   */
  const imprimir = () => {
    const anterior = document.title;
    document.title = nombreDocumento();
    const restaurar = () => {
      document.title = anterior;
      window.removeEventListener("afterprint", restaurar);
    };
    window.addEventListener("afterprint", restaurar);
    window.print();
  };

  return createPortal(
    <div
      className="print-root fixed inset-0 z-[1100] grid place-items-center bg-ink/45 p-4 backdrop-blur-sm transition-opacity duration-200 ease-out print:static print:block print:bg-transparent print:p-0 print:backdrop-blur-none"
      style={{ opacity: open ? 1 : 0 }}
      role="presentation"
      onClick={close}
      data-state={open ? "open" : "closed"}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Documento completo"
        className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-2xl border border-white bg-white shadow-2xl transition-[transform,opacity] duration-200 ease-spring will-change-transform print:max-h-none print:max-w-none print:rounded-none print:border-0 print:shadow-none"
        style={{ opacity: open ? 1 : 0, transform: open ? "translate3d(0,0,0) scale(1)" : "translate3d(0,8px,0) scale(.96)" }}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Barra de acciones: no se imprime */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4 print:hidden">
          <div>
            <span className="micro-label">Documento completo</span>
            <h2 className="font-display text-base font-extrabold text-ink">{proyecto.titulo}</h2>
            <p className="mt-0.5 text-micro text-slate-500">
              {ensamblado.length} artículo{ensamblado.length === 1 ? "" : "s"}, numerados
              según el orden del documento.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={imprimir} className="primary-button compact">
              <Printer size={13}/>
              Imprimir / PDF
            </button>
            <button type="button" onClick={close} aria-label="Cerrar" className="secondary-button compact"><X size={14}/></button>
          </div>
        </div>

        {/* El documento. Esto es lo único que se imprime. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 print:overflow-visible print:p-0">
          <article className="documento-normativo">
            {/* Marca corriente: se repite arriba de CADA página impresa. En
                pantalla no se ve. */}
            <div className="marca-corriente" aria-hidden="true">
              <span>Municipalidad de San Miguel de Tucumán · {proyecto.titulo}</span>
            </div>

            <div className="cuerpo">
              <header className="membrete">
                <p className="organismo">Municipalidad de San Miguel de Tucumán</p>
                <h1>{proyecto.titulo}</h1>
              </header>

              {ensamblado.map((articulo) => (
                <section key={articulo.articuloId} className="articulo">
                  <h2>
                    Artículo {articulo.numero}.—
                    {articulo.sumilla ? ` ${articulo.sumilla}` : ""}
                  </h2>
                  <p>{articulo.texto}</p>
                </section>
              ))}

              <footer className="pie">
                {pieDelDocumento(proyecto.titulo)
                  .split("\n")
                  .map((linea, indice) => <p key={indice}>{linea}</p>)}
              </footer>
            </div>
          </article>
        </div>
      </div>
    </div>,
    document.body,
  );
}
