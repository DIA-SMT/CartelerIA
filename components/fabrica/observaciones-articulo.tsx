"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, MessageSquarePlus, Send } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  MOTIVO_MIN_LENGTH,
  atenderObservacion,
  crearObservacion,
  loadObservaciones,
  type ArticuloNorma,
  type Observacion,
} from "@/lib/fabrica-repository";
import { ROLE_LABELS } from "@/lib/roles";
import { ConfirmDialog } from "../confirm-dialog";
import { toast } from "../toaster";

const TEXTO_MINIMO = 10;

/**
 * Observaciones de las áreas sobre un artículo.
 *
 * Es el único lugar del sistema donde el rol `consulta` escribe, y escribe una
 * opinión: no mueve un estado ni firma nada. Esa es justamente la razón de que
 * exista el rol.
 *
 * Ninguna observación se edita ni se borra, tampoco la propia. Si alguien
 * cambia de opinión agrega otra y queda el recorrido. Una opinión reescrita
 * después no sirve como antecedente de nada, y estas observaciones son
 * exactamente eso: el antecedente de por qué el articulado terminó como
 * terminó.
 */
export function ObservacionesArticulo({ articulo }: { articulo: ArticuloNorma }) {
  const auth = useAuth();
  const puedeAtender = auth.role === "administrador";

  const [observaciones, setObservaciones] = useState<Observacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [borrador, setBorrador] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [atendiendo, setAtendiendo] = useState<Observacion | null>(null);
  const [fundamentos, setFundamentos] = useState<Record<string, string>>({});
  const secuencia = useRef(0);

  const refresh = useCallback(async () => {
    const actual = ++secuencia.current;
    setCargando(true);
    const resultado = await loadObservaciones(articulo.id);
    if (actual !== secuencia.current) return;
    setObservaciones(resultado.data);
    setError(resultado.ok ? null : resultado.error);
    setCargando(false);
  }, [articulo.id]);

  useEffect(() => {
    void refresh();
    setBorrador("");
    return () => { secuencia.current += 1; };
  }, [refresh]);

  const enviar = async () => {
    const texto = borrador.trim();
    if (texto.length < TEXTO_MINIMO || enviando) return;
    setEnviando(true);
    try {
      const resultado = await crearObservacion(articulo.id, texto);
      if (!resultado.ok) {
        toast(resultado.error ?? "No se pudo guardar la observación.", "error");
        return;
      }
      setBorrador("");
      toast("Observación registrada. No se puede editar: si querés corregirla, agregá otra.");
      await refresh();
    } finally {
      setEnviando(false);
    }
  };

  const aplicarAtencion = async () => {
    if (!atendiendo) return;
    const objetivo = atendiendo;
    const texto = (fundamentos[objetivo.id] ?? "").trim();
    setAtendiendo(null);
    setFundamentos((actuales) => ({ ...actuales, [objetivo.id]: "" }));
    const resultado = await atenderObservacion(objetivo.id, texto);
    if (!resultado.ok) {
      toast(resultado.error ?? "No se pudo atender la observación.", "error");
      return;
    }
    toast("Observación atendida. El texto original queda intacto.");
    await refresh();
  };

  const pendientes = observaciones.filter((observacion) => observacion.atendidoEn === null).length;

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="micro-label">
          Observaciones de las áreas
          {observaciones.length > 0 ? ` (${observaciones.length}${pendientes > 0 ? `, ${pendientes} sin atender` : ""})` : ""}
        </span>
      </div>

      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-micro font-semibold text-red-800">
          {error}
        </p>
      )}

      {/* Escribir. Cualquier perfil reconocido, incluido consulta. */}
      <div className="mt-3">
        <textarea
          value={borrador}
          onChange={(event) => setBorrador(event.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Qué observa tu área sobre este artículo. Una vez enviada no se edita."
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-tiny leading-5 text-slate-700 outline-none focus:border-municipal-500"
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={enviar}
            disabled={enviando || borrador.trim().length < TEXTO_MINIMO}
            title={
              borrador.trim().length < TEXTO_MINIMO
                ? `Escribí al menos ${TEXTO_MINIMO} caracteres.`
                : "Enviar la observación"
            }
            className="primary-button compact disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enviando ? <Loader2 size={13} className="animate-spin"/> : <Send size={13}/>}
            Enviar observación
          </button>
          <span className="text-micro text-slate-400">
            Queda firmada con tu nombre y tu rol. No se edita ni se borra.
          </span>
        </div>
      </div>

      {cargando ? (
        <div className="mt-3 space-y-2">
          <div className="skeleton h-16 rounded-xl"/>
          <div className="skeleton h-16 rounded-xl"/>
        </div>
      ) : observaciones.length === 0 ? (
        <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-micro text-slate-500">
          <MessageSquarePlus size={12}/>
          Todavía no hay observaciones sobre este artículo.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {observaciones.map((observacion) => (
            <li
              key={observacion.id}
              className={`rounded-xl border p-3 ${
                observacion.atendidoEn ? "border-slate-100 bg-slate-50/60" : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <b className="text-micro font-extrabold text-ink">
                  {observacion.autorNombre ?? "Sin identificar"}
                </b>
                {observacion.autorRol && (
                  <span className="badge-soft">
                    <i style={{ background: "#64748b" }}/>
                    {ROLE_LABELS[observacion.autorRol]}
                  </span>
                )}
                <span className="text-micro text-slate-400">
                  {observacion.creadoEn ? new Date(observacion.creadoEn).toLocaleDateString("es-AR") : ""}
                </span>
                {observacion.atendidoEn && (
                  <span className="badge-soft"><i style={{ background: "#16a34a" }}/>Atendida</span>
                )}
              </div>

              <p className="mt-1.5 whitespace-pre-wrap text-tiny leading-5 text-slate-700">
                {observacion.texto}
              </p>

              {observacion.fundamento && (
                <p className="mt-1.5 flex items-start gap-1.5 text-micro leading-4 text-green-800">
                  <CheckCircle2 size={12} className="mt-0.5 shrink-0"/>
                  Atendida: {observacion.fundamento}
                </p>
              )}

              {!observacion.atendidoEn && puedeAtender && (
                <div className="mt-2">
                  <textarea
                    value={fundamentos[observacion.id] ?? ""}
                    onChange={(event) => setFundamentos((actuales) => ({
                      ...actuales,
                      [observacion.id]: event.target.value,
                    }))}
                    rows={2}
                    maxLength={500}
                    placeholder={`Cómo se resolvió (mínimo ${MOTIVO_MIN_LENGTH} caracteres)`}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-micro outline-none focus:border-municipal-500"
                  />
                  <button
                    type="button"
                    onClick={() => setAtendiendo(observacion)}
                    disabled={(fundamentos[observacion.id] ?? "").trim().length < MOTIVO_MIN_LENGTH}
                    title={
                      (fundamentos[observacion.id] ?? "").trim().length < MOTIVO_MIN_LENGTH
                        ? "Escribí primero cómo se resolvió."
                        : "Marcar como atendida"
                    }
                    className="secondary-button compact mt-1.5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Marcar como atendida
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {atendiendo && (
        <ConfirmDialog
          title="Marcar la observación como atendida"
          description={`De ${atendiendo.autorNombre ?? "un área"}. El texto original no se borra: queda con tu fundamento.`}
          quote={(fundamentos[atendiendo.id] ?? "").trim() || null}
          tone="approve"
          confirmLabel="Marcar como atendida"
          onConfirm={() => void aplicarAtencion()}
          onCancel={() => setAtendiendo(null)}
        />
      )}
    </div>
  );
}
