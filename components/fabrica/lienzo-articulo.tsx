"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, HelpCircle, Loader2, PenLine, ShieldQuestion, Sparkles, X } from "lucide-react";
import { useDismissible } from "@/hooks/use-dismissible";
import { useModalShell } from "@/hooks/use-modal-shell";
import {
  MOTIVO_ASISTENTE,
  MOTIVO_MIN_LENGTH,
  crearArticulo,
  proponerArticulo,
  type FragmentoRecuperado,
} from "@/lib/fabrica-repository";
import { ConfirmDialog, confirmDialogIsOpen } from "../confirm-dialog";
import { toast } from "../toaster";
import { FragmentosVigente } from "./fragmentos-vigente";

/** Piso de la ruta para pedirle una propuesta al asistente. */
const IDEA_MINIMA = 20;
/** Piso de PostgreSQL para el texto de un artículo. */
const TEXTO_MINIMO = 20;

interface PropsLienzo {
  proyectoId: string;
  onClose: () => void;
  onCreado: (articuloId: string | null) => void;
}

export function LienzoArticulo(props: PropsLienzo) {
  const [montado, setMontado] = useState(false);
  useEffect(() => { setMontado(true); }, []);
  // Igual que el articulado completo: el guard va afuera porque `useModalShell`
  // lee su ref una sola vez, al montarse.
  if (!montado) return null;
  return <PanelLienzo {...props}/>;
}

/**
 * Lienzo en blanco: de una idea en criollo a un artículo con forma jurídica.
 *
 * Las dos columnas están a la vista al mismo tiempo a propósito. Lo que se
 * escribe a la izquierda no es un prompt que se tira y se olvida: queda
 * guardado como el motivo de la primera versión del artículo. Dentro de un año
 * se va a poder abrir el historial y ver qué pidió una persona y qué escribió
 * la máquina, que es la única forma de sostener que la persona es la autora.
 *
 * Sin IA el lienzo sigue sirviendo: se escribe el artículo a la derecha a mano
 * y se crea igual. La asistencia se degrada, la herramienta no.
 */
function PanelLienzo({ proyectoId, onClose, onCreado }: PropsLienzo) {
  const { open, close } = useDismissible(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalShell(panelRef);

  const [idea, setIdea] = useState("");
  const [sumilla, setSumilla] = useState("");
  const [texto, setTexto] = useState("");
  /** true solo si el texto de la derecha lo escribió el asistente. */
  const [vieneDelAsistente, setVieneDelAsistente] = useState(false);

  const [proponiendo, setProponiendo] = useState(false);
  const [creando, setCreando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [falta, setFalta] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fragmentos, setFragmentos] = useState<FragmentoRecuperado[]>([]);
  const [confirmarSalida, setConfirmarSalida] = useState(false);

  const hayTrabajo = idea.trim().length > 0 || texto.trim().length > 0;

  const intentarCerrar = () => {
    if (hayTrabajo) { setConfirmarSalida(true); return; }
    close();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // El diálogo de confirmación está encima: le toca a él.
      if (confirmDialogIsOpen()) return;
      intentarCerrar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const articular = async () => {
    if (idea.trim().length < IDEA_MINIMA || proponiendo) return;
    setProponiendo(true);
    setAviso(null);
    setFalta(null);
    setError(null);
    try {
      const propuesta = await proponerArticulo(idea.trim());
      if (!propuesta.ok) {
        setError(propuesta.error);
        return;
      }
      setFragmentos(propuesta.fragmentos);

      if (!propuesta.asistido) {
        setAviso(MOTIVO_ASISTENTE[propuesta.motivo ?? ""] ?? "El asistente no redactó la propuesta.");
        return;
      }
      if (!propuesta.suficiente) {
        // No es un error: el asistente pide definiciones en vez de inventar un
        // plazo o una medida. Eso es exactamente lo que tiene que hacer.
        setFalta(propuesta.falta ?? "Faltan definiciones para escribir el artículo.");
        return;
      }
      setTexto(propuesta.texto);
      setSumilla(propuesta.sumilla ?? "");
      setVieneDelAsistente(true);
      toast("Propuesta redactada. Revisala y editala antes de crear el artículo.");
    } finally {
      setProponiendo(false);
    }
  };

  const crear = async () => {
    if (creando) return;
    if (texto.trim().length < TEXTO_MINIMO) {
      setError(`El artículo necesita al menos ${TEXTO_MINIMO} caracteres.`);
      return;
    }
    if (idea.trim().length < MOTIVO_MIN_LENGTH) {
      setError(`Contá de dónde sale el artículo (mínimo ${MOTIVO_MIN_LENGTH} caracteres).`);
      return;
    }
    setCreando(true);
    setError(null);
    try {
      const resultado = await crearArticulo({
        proyectoId,
        texto: texto.trim(),
        sumilla: sumilla.trim() || null,
        // Solo se declara asistido si el texto lo escribió la máquina. Si lo
        // escribiste vos, el origen no puede decir otra cosa.
        origen: vieneDelAsistente ? "asistente" : "redactado",
        motivo: idea.trim(),
      });
      if (!resultado.ok) {
        setError(resultado.error);
        toast(resultado.error ?? "No se pudo crear el artículo.", "error");
        return;
      }
      toast("Artículo creado al final del articulado, en estado propuesto.");
      onCreado(resultado.articuloId);
      close();
    } finally {
      setCreando(false);
    }
  };

  const faltanParaArticular = IDEA_MINIMA - idea.trim().length;

  return createPortal(
    <div
      className="fixed inset-0 z-[1100] grid place-items-center bg-ink/45 p-4 backdrop-blur-sm transition-opacity duration-200 ease-out"
      style={{ opacity: open ? 1 : 0 }}
      role="presentation"
      onClick={intentarCerrar}
      data-state={open ? "open" : "closed"}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Artículo nuevo"
        className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-2xl border border-white bg-white shadow-2xl transition-[transform,opacity] duration-200 ease-spring will-change-transform"
        style={{ opacity: open ? 1 : 0, transform: open ? "translate3d(0,0,0) scale(1)" : "translate3d(0,8px,0) scale(.96)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-100 p-4">
          <div>
            <span className="micro-label">Artículo nuevo</span>
            <h2 className="font-display text-base font-extrabold text-ink">
              Escribilo como se lo contarías a alguien
            </h2>
            <p className="mt-0.5 text-micro leading-4 text-slate-500">
              Lo que escribas a la izquierda queda guardado como el motivo de la primera
              versión. No se pierde.
            </p>
          </div>
          <button type="button" onClick={intentarCerrar} aria-label="Cerrar" className="secondary-button compact shrink-0">
            <X size={14}/>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Izquierda: en criollo */}
            <div>
              <label className="block">
                <span className="micro-label">Tu idea, en tus palabras</span>
                <textarea
                  value={idea}
                  onChange={(event) => setIdea(event.target.value)}
                  rows={14}
                  maxLength={4000}
                  autoFocus
                  placeholder={"Ejemplo: que no se pueda poner un cartel a menos de treinta metros de una esquina, salvo que sea de la propia casa o comercio, y que el que ya esté puesto tenga un año para sacarlo."}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-tiny leading-5 text-slate-700 outline-none focus:border-municipal-500"
                />
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={articular}
                  disabled={proponiendo || faltanParaArticular > 0}
                  title={
                    faltanParaArticular > 0
                      ? `Escribí ${faltanParaArticular} caracteres más para pedirle una propuesta al asistente.`
                      : "Convertir la idea en un artículo"
                  }
                  className="primary-button compact disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {proponiendo ? <Loader2 size={13} className="animate-spin"/> : <Sparkles size={13}/>}
                  Articular
                  <ArrowRight size={13} className="hidden lg:inline"/>
                </button>
                <span className="text-micro text-slate-400">
                  {idea.trim().length} caracteres
                </span>
              </div>
            </div>

            {/* Derecha: el artículo */}
            <div>
              <label className="block">
                <span className="micro-label">Sumilla</span>
                <input
                  value={sumilla}
                  onChange={(event) => setSumilla(event.target.value)}
                  maxLength={200}
                  placeholder="De qué trata el artículo"
                  className="mt-1 min-h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-tiny text-slate-700 outline-none focus:border-municipal-500"
                />
              </label>
              <label className="mt-3 block">
                <span className="micro-label">
                  Texto del artículo
                  {vieneDelAsistente && (
                    <span className="badge-soft ml-1.5">
                      <i style={{ background: "#0891b2" }}/>
                      Propuesto por el asistente
                    </span>
                  )}
                </span>
                <textarea
                  value={texto}
                  onChange={(event) => {
                    setTexto(event.target.value);
                    if (event.target.value.trim().length === 0) setVieneDelAsistente(false);
                  }}
                  rows={11}
                  placeholder="Acá aparece la propuesta. También podés escribirlo vos directamente."
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-tiny leading-5 text-slate-700 outline-none focus:border-municipal-500"
                />
              </label>
              {vieneDelAsistente && (
                <p className="mt-1.5 text-micro leading-4 text-slate-500">
                  Editalo con confianza: el texto que se guarde es el que quede acá, y el
                  artículo nace en estado propuesto para que lo revises.
                </p>
              )}
            </div>
          </div>

          {/* Lo que el asistente pide antes de escribir */}
          {falta && (
            <div role="status" className="mt-4 rounded-xl border border-municipal-200 bg-municipal-50 p-3">
              <p className="flex items-start gap-1.5 text-micro font-bold text-municipal-800">
                <HelpCircle size={12} className="mt-0.5 shrink-0"/>
                El asistente necesita que definas esto primero
              </p>
              <p className="mt-1 text-tiny leading-5 text-municipal-900">{falta}</p>
              <p className="mt-1.5 text-micro leading-4 text-municipal-700">
                Agregalo a tu idea y volvé a articular. Prefiere pedirte una definición
                antes que entregarte un artículo con un vacío adentro.
              </p>
            </div>
          )}

          {aviso && (
            <p className="mt-4 flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-micro leading-4 text-amber-800">
              <ShieldQuestion size={12} className="mt-0.5 shrink-0"/>
              {aviso} Podés escribir el artículo vos mismo en la columna de la derecha.
            </p>
          )}

          {error && (
            <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-micro font-semibold text-red-800">
              {error}
            </p>
          )}

          <FragmentosVigente fragmentos={fragmentos} asistido={aviso === null}/>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-100 p-4">
          <p className="text-micro leading-4 text-slate-400">
            El artículo se agrega al final, en estado propuesto. Contrastarlo con la
            vigente es el paso siguiente, desde el editor.
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={intentarCerrar} className="secondary-button compact">
              Cancelar
            </button>
            <button
              type="button"
              onClick={crear}
              disabled={creando || texto.trim().length < TEXTO_MINIMO || idea.trim().length < MOTIVO_MIN_LENGTH}
              title={
                texto.trim().length < TEXTO_MINIMO
                  ? "Todavía no hay artículo que crear."
                  : idea.trim().length < MOTIVO_MIN_LENGTH
                    ? "Contá de dónde sale el artículo en la columna de la izquierda."
                    : "Crear el artículo"
              }
              className="primary-button compact disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creando ? <Loader2 size={13} className="animate-spin"/> : <PenLine size={13}/>}
              Crear artículo
            </button>
          </div>
        </div>
      </div>

      {confirmarSalida && (
        <ConfirmDialog
          title="Salir sin crear el artículo"
          description="Lo que escribiste no se guardó en ningún lado y se pierde."
          quote={(texto.trim() || idea.trim()).slice(0, 200) || null}
          tone="discard"
          confirmLabel="Salir y perderlo"
          onConfirm={() => { setConfirmarSalida(false); close(); }}
          onCancel={() => setConfirmarSalida(false)}
        />
      )}
    </div>,
    document.body,
  );
}
