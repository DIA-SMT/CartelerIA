"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, FileDown, Loader2, Printer, X } from "lucide-react";
import { useDismissible } from "@/hooks/use-dismissible";
import { useModalShell } from "@/hooks/use-modal-shell";
import type { ArticuloNorma, ProyectoNorma } from "@/lib/fabrica-repository";
import { loadDiagnosticosDelProyecto } from "@/lib/fabrica-repository";
import {
  ensamblarArticulado,
  evaluarElevacion,
  exportarArticuladoWord,
  nombreDocumento,
  pieDelDocumento,
  type EvaluacionElevacion,
} from "@/lib/norma-export";
import { toast } from "../toaster";

/**
 * Articulado completo, ensamblado y listo para exportar.
 *
 * Dos salidas y la diferencia importa. La versión de trabajo está siempre
 * disponible y lleva la marca de borrador en cada página. La versión para
 * elevar es fail-closed: si falta una aprobación o queda un diagnóstico grave
 * sin atender, no se genera y se dice exactamente qué falta.
 *
 * El PDF sale de la vista para imprimir, con el membrete resuelto en CSS
 * `@media print`. Cualquiera guarda como PDF desde el navegador y el resultado
 * es correcto: meter un navegador headless en una función serverless sería la
 * dependencia más pesada y frágil del proyecto para conseguir lo mismo.
 *
 * El panel va por `createPortal` a `document.body`, y para el PDF eso no es
 * cosmético: la regla de impresión apaga a los hermanos directos de `body`, así
 * que montado dentro del árbol del tablero se imprimía la página entera —mapa,
 * tablas y todo— con el documento en el medio.
 */
interface PropsArticulado {
  proyecto: ProyectoNorma;
  articulos: ArticuloNorma[];
  onClose: () => void;
  onIrAlArticulo: (articuloId: string) => void;
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

function PanelArticulado({ proyecto, articulos, onClose, onIrAlArticulo }: PropsArticulado) {
  const { open, close } = useDismissible(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalShell(panelRef);
  const [evaluacion, setEvaluacion] = useState<EvaluacionElevacion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);

  const ensamblado = ensamblarArticulado(articulos);

  const evaluar = useCallback(async () => {
    setCargando(true);
    const resultado = await loadDiagnosticosDelProyecto(proyecto.id);
    if (!resultado.ok) {
      // Fail-closed: sin poder verificar los diagnósticos no se habilita la
      // versión oficial. No saber no es lo mismo que estar en condiciones.
      setError(resultado.error);
      setEvaluacion({
        puede: false,
        faltantes: [{
          tipo: "diagnostico_grave_sin_atender",
          articuloId: "",
          detalle: "No se pudieron verificar los diagnósticos del proyecto.",
        }],
      });
      setCargando(false);
      return;
    }
    setError(null);
    setEvaluacion(evaluarElevacion(articulos, resultado.data));
    setCargando(false);
  }, [proyecto.id, articulos]);

  useEffect(() => { void evaluar(); }, [evaluar]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const exportar = async (oficial: boolean) => {
    if (oficial && !evaluacion?.puede) return;
    setExportando(true);
    try {
      await exportarArticuladoWord({ proyecto: proyecto.titulo, articulos: ensamblado, oficial });
      toast(oficial ? "Documento para elevar generado." : "Versión de trabajo generada.");
    } catch {
      toast("No se pudo generar el documento.", "error");
    } finally {
      setExportando(false);
    }
  };

  const sinAprobar = ensamblado.filter((articulo) => !articulo.aprobado).length;

  // Una sola fuente de verdad para "esto es oficial". Antes la marca de
  // borrador miraba `sinAprobar` y el pie miraba la evaluación, así que un
  // articulado con todo aprobado pero con un diagnóstico grave sin atender
  // salía sin marca arriba y con la leyenda de borrador abajo. Un documento
  // que se contradice a sí mismo sobre si es oficial es peor que uno que se
  // declara borrador de más.
  //
  // `evaluarElevacion` ya exige todos los artículos aprobados, así que no hace
  // falta volver a mirar `sinAprobar`: si `puede` es true, no hay ninguno.
  const esOficial = Boolean(evaluacion?.puede);

  const motivoBorrador = cargando
    ? "verificación pendiente"
    : sinAprobar > 0
      ? `${sinAprobar} artículo${sinAprobar === 1 ? "" : "s"} sin aprobar`
      : evaluacion?.faltantes.some((f) => f.tipo === "diagnostico_grave_sin_atender")
        ? "diagnósticos graves sin atender"
        : "sin verificar";

  /**
   * El navegador nombra el PDF con `document.title` y lo imprime en su propio
   * encabezado. Sin esto el archivo sale llamándose como la aplicación, que no
   * dice qué documento es ni si es oficial.
   */
  const imprimir = () => {
    const anterior = document.title;
    document.title = nombreDocumento(esOficial);
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
        aria-label="Articulado completo"
        className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-2xl border border-white bg-white shadow-2xl transition-[transform,opacity] duration-200 ease-spring will-change-transform print:max-h-none print:max-w-none print:rounded-none print:border-0 print:shadow-none"
        style={{ opacity: open ? 1 : 0, transform: open ? "translate3d(0,0,0) scale(1)" : "translate3d(0,8px,0) scale(.96)" }}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Barra de acciones: no se imprime */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4 print:hidden">
          <div>
            <span className="micro-label">Articulado completo</span>
            <h2 className="font-display text-base font-extrabold text-ink">{proyecto.titulo}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => exportar(false)}
              disabled={exportando}
              className="secondary-button compact"
            >
              {exportando ? <Loader2 size={13} className="animate-spin"/> : <FileDown size={13}/>}
              Word de trabajo
            </button>
            <button
              type="button"
              onClick={() => exportar(true)}
              disabled={exportando || cargando || !evaluacion?.puede}
              title={evaluacion?.puede ? "Generar el documento para elevar" : "Falta completar el articulado"}
              className="primary-button compact disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileDown size={13}/>
              Word para elevar
            </button>
            <button type="button" onClick={imprimir} className="secondary-button compact">
              <Printer size={13}/>
              Imprimir / PDF
            </button>
            <button type="button" onClick={close} aria-label="Cerrar" className="secondary-button compact"><X size={14}/></button>
          </div>
        </div>

        {/* Estado de la compuerta: tampoco se imprime */}
        <div className="shrink-0 px-4 pt-3 print:hidden">
          {cargando ? (
            <div className="skeleton h-10 rounded-xl"/>
          ) : evaluacion?.puede ? (
            <p className="rounded-xl bg-green-50 px-3 py-2 text-micro font-semibold text-green-800">
              Todos los artículos están aprobados y no quedan diagnósticos graves sin atender.
              El documento para elevar se puede generar.
            </p>
          ) : (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="flex items-start gap-1.5 text-micro font-bold text-amber-900">
                <AlertTriangle size={12} className="mt-0.5 shrink-0"/>
                {error ?? "No se puede generar el documento para elevar todavía."}
              </p>
              <ul className="mt-1.5 space-y-1">
                {(evaluacion?.faltantes ?? []).slice(0, 12).map((faltante, indice) => (
                  <li key={`${faltante.articuloId}-${indice}`} className="text-micro text-amber-900">
                    {faltante.articuloId ? (
                      <button
                        type="button"
                        onClick={() => { onIrAlArticulo(faltante.articuloId); close(); }}
                        className="underline underline-offset-2 hover:text-municipal-700"
                      >
                        {faltante.detalle}
                      </button>
                    ) : faltante.detalle}
                  </li>
                ))}
              </ul>
              {(evaluacion?.faltantes.length ?? 0) > 12 && (
                <p className="mt-1 text-micro text-amber-800">
                  y {(evaluacion?.faltantes.length ?? 0) - 12} más.
                </p>
              )}
            </div>
          )}
        </div>

        {/* El documento. Esto es lo único que se imprime. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 print:overflow-visible print:p-0">
          <article className="documento-normativo">
            {/* Marca corriente: se repite arriba de CADA página impresa, porque
                una hoja suelta de un borrador tiene que poder identificarse sin
                el resto del documento. En pantalla no se ve. */}
            <div className="marca-corriente" aria-hidden="true">
              <span>Municipalidad de San Miguel de Tucumán · {proyecto.titulo}</span>
              {!esOficial && <b>BORRADOR — NO OFICIAL</b>}
            </div>

            <div className="cuerpo">
              <header className="membrete">
                <p className="organismo">Municipalidad de San Miguel de Tucumán</p>
                <h1>{proyecto.titulo}</h1>
                {!esOficial && <p className="marca-borrador">BORRADOR · {motivoBorrador}</p>}
              </header>

              {ensamblado.map((articulo) => (
                <section key={articulo.articuloId} className="articulo">
                  <h2>
                    Artículo {articulo.numero}.—
                    {articulo.sumilla ? ` ${articulo.sumilla}` : ""}
                    {!articulo.aprobado && (
                      <span className="badge-soft ml-2 print:hidden">
                        <i style={{ background: "#f59e0b" }}/>
                        Sin aprobar
                      </span>
                    )}
                    {!articulo.aprobado && <span className="solo-impresion"> [SIN APROBAR]</span>}
                  </h2>
                  <p>{articulo.texto}</p>
                </section>
              ))}

              <footer className="pie">
                {pieDelDocumento(proyecto.titulo, esOficial)
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
