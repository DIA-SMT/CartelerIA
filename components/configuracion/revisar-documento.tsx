"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ExternalLink, Loader2, X } from "lucide-react";
import { useDismissible } from "@/hooks/use-dismissible";
import { useModalShell } from "@/hooks/use-modal-shell";
import {
  habilitarDocumentoIaExterna,
  loadFragmentosDocumento,
  type DocumentoCorpus,
  type FragmentoIndexado,
} from "@/lib/configuracion-repository";
import { ROLE_REASON_MIN_LENGTH } from "@/lib/roles";
import { ConfirmDialog, confirmDialogIsOpen } from "../confirm-dialog";
import { toast } from "../toaster";

interface PropsRevision {
  documento: DocumentoCorpus;
  onClose: () => void;
  onCambio: () => void;
}

export function RevisarDocumento(props: PropsRevision) {
  const [montado, setMontado] = useState(false);
  useEffect(() => { setMontado(true); }, []);
  if (!montado) return null;
  return <PanelRevision {...props}/>;
}

/**
 * Revisión del texto indexado de un documento y decisión sobre su salida.
 *
 * Lo que se lee acá es el texto tal como quedó indexado, no el PDF: entre los
 * dos está el OCR, que es donde aparecen los errores. Marcar como revisado sin
 * leer esto sería firmar que un texto es fiel sin haberlo mirado, y el sistema
 * después usa esa firma para dejarlo salir del municipio.
 *
 * Editar el texto todavía no se puede: la corrección tiene que volver al
 * archivo de OCR, que es de donde se deriva la base, o la próxima reingesta se
 * la lleva puesta sin avisar.
 */
function PanelRevision({ documento, onClose, onCambio }: PropsRevision) {
  const { open, close } = useDismissible(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalShell(panelRef);

  const [fragmentos, setFragmentos] = useState<FragmentoIndexado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fundamento, setFundamento] = useState("");
  const [pendiente, setPendiente] = useState<{ revisado: boolean; iaExterna: boolean } | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const secuencia = useRef(0);

  useEffect(() => {
    const actual = ++secuencia.current;
    setCargando(true);
    void loadFragmentosDocumento(documento.id).then((resultado) => {
      if (actual !== secuencia.current) return;
      setFragmentos(resultado.data);
      setError(resultado.ok ? null : resultado.error);
      setCargando(false);
    });
    return () => { secuencia.current += 1; };
  }, [documento.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || confirmDialogIsOpen()) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const aplicar = async () => {
    if (!pendiente || aplicando) return;
    const decision = pendiente;
    setAplicando(true);
    try {
      const resultado = await habilitarDocumentoIaExterna({
        documentoId: documento.id,
        revisado: decision.revisado,
        iaExterna: decision.iaExterna,
        fundamento: fundamento.trim(),
      });
      if (!resultado.ok) {
        toast(resultado.error ?? "No se pudo aplicar la decisión.", "error");
        return;
      }
      toast(
        decision.iaExterna
          ? "Documento habilitado para IA externa. Queda asentado quién lo autorizó."
          : "Decisión registrada.",
      );
      setPendiente(null);
      setFundamento("");
      onCambio();
      close();
    } finally {
      setAplicando(false);
    }
  };

  const fundamentoCorto = fundamento.trim().length < ROLE_REASON_MIN_LENGTH;
  const caracteres = fragmentos.reduce((total, fragmento) => total + fragmento.contenido.length, 0);

  return createPortal(
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
        aria-label={`Revisar ${documento.titulo}`}
        className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-2xl border border-white bg-white shadow-2xl transition-[transform,opacity] duration-200 ease-spring will-change-transform"
        style={{ opacity: open ? 1 : 0, transform: open ? "translate3d(0,0,0) scale(1)" : "translate3d(0,8px,0) scale(.96)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-100 p-4">
          <div>
            <span className="micro-label">Texto indexado</span>
            <h2 className="font-display text-base font-extrabold text-ink">{documento.titulo}</h2>
            <p className="mt-0.5 text-micro leading-4 text-slate-500">
              {documento.chunks} fragmentos · {caracteres.toLocaleString("es-AR")} caracteres.
              Esto es lo que vería el modelo, no lo que dice el PDF.
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Cerrar" className="secondary-button compact shrink-0">
            <X size={14}/>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-micro leading-4 text-amber-800">
            <AlertTriangle size={12} className="mt-0.5 shrink-0"/>
            Corregir el texto todavía no se hace desde acá: la corrección tiene que volver al
            archivo de OCR, que es de donde se deriva la base. Si se guardara sólo en la base,
            la próxima reingesta se la llevaría puesta sin avisar.
          </p>

          {cargando ? (
            <div className="mt-3 space-y-2">
              <div className="skeleton h-20 rounded-xl"/>
              <div className="skeleton h-20 rounded-xl"/>
              <div className="skeleton h-20 rounded-xl"/>
            </div>
          ) : error ? (
            <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-micro font-semibold text-red-800">
              {error}
            </p>
          ) : (
            <ol className="mt-3 space-y-2">
              {fragmentos.map((fragmento, indice) => (
                <li key={fragmento.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <span className="micro-label">
                    Fragmento {indice + 1}
                    {fragmento.seccion ? ` · ${fragmento.seccion}` : ""}
                    {fragmento.pagina !== null ? ` · pág. ${fragmento.pagina}` : ""}
                  </span>
                  <p className="mt-1 whitespace-pre-wrap text-micro leading-4 text-slate-600">
                    {fragmento.contenido}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-100 p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="badge-soft">
              <i style={{ background: documento.revisadoPorHumano ? "#16a34a" : "#f59e0b" }}/>
              {documento.revisadoPorHumano ? "Revisado por humano" : "Sin revisar"}
            </span>
            <span className="badge-soft">
              <i style={{ background: documento.iaExternaHabilitada ? "#dc2626" : "#64748b" }}/>
              {documento.iaExternaHabilitada ? "Sale a IA externa" : "No sale del municipio"}
            </span>
            {documento.audiencia !== "publico" && (
              <span className="badge-soft"><i style={{ background: "#64748b" }}/>Interno: no puede salir</span>
            )}
          </div>

          <label className="mt-3 block">
            <span className="micro-label">Fundamento de la decisión (obligatorio)</span>
            <textarea
              value={fundamento}
              onChange={(event) => setFundamento(event.target.value)}
              rows={2}
              maxLength={500}
              placeholder={`Qué leíste y por qué decidís esto (mínimo ${ROLE_REASON_MIN_LENGTH} caracteres)`}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-tiny text-slate-700 outline-none focus:border-municipal-500"
            />
          </label>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPendiente({ revisado: true, iaExterna: true })}
              disabled={aplicando || cargando || fundamentoCorto || documento.audiencia !== "publico"}
              title={
                documento.audiencia !== "publico"
                  ? "Un documento interno no sale del municipio."
                  : fundamentoCorto
                    ? "Escribí primero el fundamento."
                    : "Marcar como revisado y dejarlo salir a IA externa"
              }
              className="primary-button compact disabled:cursor-not-allowed disabled:opacity-50"
            >
              {aplicando ? <Loader2 size={13} className="animate-spin"/> : <ExternalLink size={13}/>}
              Revisado y habilitado para IA externa
            </button>
            <button
              type="button"
              onClick={() => setPendiente({ revisado: true, iaExterna: false })}
              disabled={aplicando || cargando || fundamentoCorto}
              title={fundamentoCorto ? "Escribí primero el fundamento." : "Marcar como revisado, sin dejarlo salir"}
              className="secondary-button compact disabled:cursor-not-allowed disabled:opacity-50"
            >
              Revisado, pero no sale
            </button>
            {(documento.revisadoPorHumano || documento.iaExternaHabilitada) && (
              <button
                type="button"
                onClick={() => setPendiente({ revisado: false, iaExterna: false })}
                disabled={aplicando || fundamentoCorto}
                title={fundamentoCorto ? "Escribí primero el fundamento." : "Dar de baja la habilitación"}
                className="secondary-button compact disabled:cursor-not-allowed disabled:opacity-50"
              >
                Dar de baja
              </button>
            )}
          </div>
        </div>
      </div>

      {pendiente && (
        <ConfirmDialog
          title={pendiente.iaExterna
            ? "Dejar que este documento salga del municipio"
            : pendiente.revisado
              ? "Marcar el documento como revisado"
              : "Dar de baja la habilitación"}
          description={pendiente.iaExterna
            ? `El texto de "${documento.titulo}" se va a enviar a un proveedor externo cada vez que el asistente lo necesite. Queda asentado con tu nombre.`
            : pendiente.revisado
              ? "Queda constancia de que leíste el texto indexado. No habilita la salida hacia IA externa."
              : "El documento deja de salir del municipio y vuelve a figurar como sin revisar."}
          quote={fundamento.trim() || null}
          tone={pendiente.iaExterna ? "approve" : "reject"}
          confirmLabel={pendiente.iaExterna ? "Habilitar la salida" : pendiente.revisado ? "Marcar revisado" : "Dar de baja"}
          onConfirm={() => void aplicar()}
          onCancel={() => setPendiente(null)}
        />
      )}
    </div>,
    document.body,
  );
}
