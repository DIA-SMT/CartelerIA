"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, Loader2, MapPin, Play, Scale, ShieldQuestion } from "lucide-react";
import type { AnalyzedCartel } from "@/data/territorial";
import { useAuth } from "@/hooks/use-auth";
import {
  MOTIVO_ASISTENTE,
  MOTIVO_MIN_LENGTH,
  atenderDiagnostico,
  confirmarParametro,
  diagnosticarContraVigente,
  loadDiagnosticos,
  loadParametros,
  type ArticuloNorma,
  type DiagnosticoGuardado,
  type ParametroGuardado,
} from "@/lib/fabrica-repository";
import {
  PARAMETRO_LABELS,
  ParametroSinConfirmarError,
  simularArticulo,
  type ClaveParametro,
  type ResumenSimulacion,
} from "@/lib/norma-simulador";
import { ConfirmDialog } from "../confirm-dialog";
import { toast } from "../toaster";

const SEVERIDAD_COLORS: Record<string, string> = {
  alta: "#dc2626",
  media: "#f59e0b",
  baja: "#64748b",
};

/** Parámetros numéricos y su unidad. Las zonas se cargan aparte. */
const NUMERICOS: { clave: ClaveParametro; unidad: string; ayuda: string }[] = [
  { clave: "superficie_maxima_m2", unidad: "m²", ayuda: "El máximo es… metros cuadrados" },
  { clave: "distancia_minima_corredor_m", unidad: "m", ayuda: "Se exige una distancia mínima de… al corredor" },
  { clave: "distancia_minima_lugar_permitido_m", unidad: "m", ayuda: "Se exige una distancia mínima de… al lugar permitido" },
];

/**
 * Diagnóstico de un artículo: contra el texto vigente y contra los carteles.
 *
 * Son dos cosas distintas y no se mezclan porque se verifican distinto. El
 * primero depende de citas textuales verificadas; el segundo, de parámetros que
 * una persona confirmó y de un motor determinístico.
 */
export function PanelDiagnostico({
  articulo,
  carteles,
  onVerEnMapa,
}: {
  articulo: ArticuloNorma;
  carteles: AnalyzedCartel[];
  onVerEnMapa: (ids: string[]) => void;
}) {
  const auth = useAuth();
  const puedeConfirmar = auth.canInspect;
  const puedeAtender = auth.role === "administrador" || auth.role === "coordinador";

  const [parametros, setParametros] = useState<ParametroGuardado[]>([]);
  const [diagnosticos, setDiagnosticos] = useState<DiagnosticoGuardado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diagnosticando, setDiagnosticando] = useState(false);
  const [avisoAsistente, setAvisoAsistente] = useState<string | null>(null);
  const [fragmentos, setFragmentos] = useState<{ titulo: string; seccion: string | null; contenido: string }[]>([]);
  const [simulacion, setSimulacion] = useState<ResumenSimulacion | null>(null);
  const [errorSimulacion, setErrorSimulacion] = useState<string | null>(null);
  const [atendiendo, setAtendiendo] = useState<DiagnosticoGuardado | null>(null);
  const [fundamentos, setFundamentos] = useState<Record<string, string>>({});
  const secuencia = useRef(0);

  const refresh = useCallback(async () => {
    const actual = ++secuencia.current;
    setCargando(true);
    const [p, d] = await Promise.all([
      loadParametros(articulo.id),
      loadDiagnosticos(articulo.id),
    ]);
    if (actual !== secuencia.current) return;
    setParametros(p.data);
    setDiagnosticos(d.data);
    setError(p.ok && d.ok ? null : (p.error ?? d.error));
    setCargando(false);
  }, [articulo.id]);

  useEffect(() => {
    void refresh();
    setSimulacion(null);
    setErrorSimulacion(null);
    setAvisoAsistente(null);
    setFragmentos([]);
    return () => { secuencia.current += 1; };
  }, [refresh]);

  const correrDiagnostico = async () => {
    setDiagnosticando(true);
    setAvisoAsistente(null);
    try {
      const resultado = await diagnosticarContraVigente(articulo.id, articulo.texto);
      if (!resultado.ok) {
        toast(resultado.error ?? "No se pudo ejecutar el diagnóstico.", "error");
        return;
      }
      setFragmentos(resultado.fragmentos);
      if (!resultado.asistido) {
        setAvisoAsistente(MOTIVO_ASISTENTE[resultado.motivo ?? ""] ?? "El asistente no redactó hallazgos.");
      } else {
        toast("Diagnóstico ejecutado. Solo se registran los hallazgos con cita verificada.");
      }
      await refresh();
    } finally {
      setDiagnosticando(false);
    }
  };

  const correrSimulacion = () => {
    setErrorSimulacion(null);
    try {
      const { resumen } = simularArticulo(
        carteles,
        parametros.map((parametro) => ({
          clave: parametro.clave,
          valor: parametro.valor,
          unidad: parametro.unidad,
          cita: parametro.cita,
          confirmado: parametro.confirmadoEn !== null,
        })),
      );
      setSimulacion(resumen);
    } catch (fallo) {
      // Un parámetro sin confirmar no se ignora: la simulación falla y se dice
      // por qué. Un número calculado sobre supuestos no sirve para decidir.
      setSimulacion(null);
      setErrorSimulacion(
        fallo instanceof ParametroSinConfirmarError
          ? fallo.message
          : "No se pudo correr la simulación.",
      );
    }
  };

  const aplicarAtencion = async () => {
    if (!atendiendo) return;
    const objetivo = atendiendo;
    const texto = (fundamentos[objetivo.id] ?? "").trim();
    setAtendiendo(null);
    setFundamentos((actuales) => ({ ...actuales, [objetivo.id]: "" }));
    const resultado = await atenderDiagnostico(objetivo.id, texto);
    if (!resultado.ok) {
      toast(resultado.error ?? "No se pudo atender el diagnóstico.", "error");
      return;
    }
    toast("Diagnóstico atendido. El hallazgo queda con su fundamento.");
    await refresh();
  };

  const sinAtender = diagnosticos.filter((d) => d.atendidoEn === null);
  const gravesSinAtender = sinAtender.filter((d) => d.severidad === "alta").length;

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="micro-label">Diagnóstico del artículo</span>
        <button
          type="button"
          onClick={correrDiagnostico}
          disabled={diagnosticando || articulo.texto.length < 20}
          className="secondary-button compact disabled:cursor-not-allowed disabled:opacity-50"
        >
          {diagnosticando ? <Loader2 size={13} className="animate-spin"/> : <Scale size={13}/>}
          Contrastar con la vigente
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-micro font-semibold text-red-800">{error}</p>
      )}

      {avisoAsistente && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-micro leading-4 text-amber-800">
          <ShieldQuestion size={12} className="mt-0.5 shrink-0"/>
          {avisoAsistente}
        </p>
      )}

      {/* Fragmentos de la vigente, útiles incluso sin asistente */}
      {fragmentos.length > 0 && (
        <details className="mt-2 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
          <summary className="cursor-pointer text-micro font-extrabold uppercase tracking-wider text-slate-500">
            Normativa vigente relacionada ({fragmentos.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {fragmentos.map((fragmento, indice) => (
              <li key={indice} className="rounded-lg bg-white p-2.5">
                <span className="micro-label">{fragmento.titulo}{fragmento.seccion ? ` · ${fragmento.seccion}` : ""}</span>
                <p className="mt-1 text-micro leading-4 text-slate-600">{fragmento.contenido}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Hallazgos */}
      {cargando ? (
        <div className="mt-3 space-y-2">
          <div className="skeleton h-14 rounded-xl"/>
          <div className="skeleton h-14 rounded-xl"/>
        </div>
      ) : diagnosticos.length > 0 && (
        <div className="mt-3">
          <span className="micro-label">
            Hallazgos ({sinAtender.length} sin atender{gravesSinAtender > 0 ? `, ${gravesSinAtender} graves` : ""})
          </span>
          <ul className="mt-2 space-y-2">
            {diagnosticos.map((diagnostico) => (
              <li
                key={diagnostico.id}
                className={`rounded-xl border p-3 ${
                  diagnostico.atendidoEn ? "border-slate-100 bg-slate-50/60" : "border-amber-200 bg-white"
                }`}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="badge-soft">
                    <i style={{ background: SEVERIDAD_COLORS[diagnostico.severidad] }}/>
                    {diagnostico.severidad}
                  </span>
                  <span className="badge-soft">
                    <i style={{ background: "#64748b" }}/>
                    {diagnostico.tipo.replace(/_/g, " ")}
                  </span>
                  {diagnostico.confianza && (
                    <span className="text-micro font-semibold text-slate-400">
                      confianza {diagnostico.confianza}
                    </span>
                  )}
                  {diagnostico.atendidoEn && (
                    <span className="badge-soft"><i style={{ background: "#16a34a" }}/>Atendido</span>
                  )}
                </div>
                <p className="mt-1.5 text-tiny leading-5 text-slate-700">{diagnostico.descripcion}</p>
                {diagnostico.cita && (
                  <blockquote className="mt-1.5 border-l-2 border-slate-300 pl-2 text-micro italic leading-4 text-slate-500">
                    “{diagnostico.cita}”
                    {diagnostico.referencia ? <span className="not-italic"> — {diagnostico.referencia}</span> : null}
                  </blockquote>
                )}
                {diagnostico.fundamento && (
                  <p className="mt-1.5 text-micro leading-4 text-green-800">
                    Atendido: {diagnostico.fundamento}
                  </p>
                )}
                {!diagnostico.atendidoEn && puedeAtender && (
                  <div className="mt-2">
                    <textarea
                      value={fundamentos[diagnostico.id] ?? ""}
                      onChange={(event) => setFundamentos((actuales) => ({
                        ...actuales,
                        [diagnostico.id]: event.target.value,
                      }))}
                      rows={2}
                      maxLength={500}
                      placeholder={`Cómo se atendió (mínimo ${MOTIVO_MIN_LENGTH} caracteres)`}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-micro outline-none focus:border-municipal-500"
                    />
                    <button
                      type="button"
                      onClick={() => setAtendiendo(diagnostico)}
                      disabled={(fundamentos[diagnostico.id] ?? "").trim().length < MOTIVO_MIN_LENGTH}
                      title={
                        (fundamentos[diagnostico.id] ?? "").trim().length < MOTIVO_MIN_LENGTH
                          ? "Escribí primero cómo se atendió."
                          : "Atender el hallazgo"
                      }
                      className="secondary-button compact mt-1.5 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Atender con fundamento
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Parámetros y simulación */}
      <div className="mt-4 border-t border-slate-100 pt-4">
        <span className="micro-label">Impacto sobre los carteles relevados</span>
        <p className="mt-1 text-micro leading-4 text-slate-500">
          Un parámetro es una regla que se pueda escribir en una oración: “el máximo es…”,
          “se exige…”, “se prohíbe…”. Si no entra en esa forma, no es un parámetro.
        </p>

        <div className="mt-3 grid gap-2">
          {NUMERICOS.map((definicion) => (
            <FilaParametro
              key={definicion.clave}
              definicion={definicion}
              articulo={articulo}
              guardado={parametros.find((parametro) => parametro.clave === definicion.clave) ?? null}
              puedeConfirmar={puedeConfirmar}
              onGuardado={refresh}
            />
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={correrSimulacion}
            disabled={parametros.length === 0 || carteles.length === 0}
            title={parametros.length === 0 ? "Confirmá al menos un parámetro." : "Correr la simulación"}
            className="primary-button compact disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play size={13}/>
            Simular sobre {carteles.length} carteles
          </button>
          {simulacion && simulacion.idsNoCumple.length > 0 && (
            <button
              type="button"
              onClick={() => onVerEnMapa(simulacion.idsNoCumple)}
              className="secondary-button compact"
            >
              <MapPin size={13}/>
              Ver en el mapa los {simulacion.idsNoCumple.length} que no cumplen
            </button>
          )}
        </div>

        {errorSimulacion && (
          <p role="alert" className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-micro font-semibold leading-4 text-amber-800">
            <AlertTriangle size={12} className="mt-0.5 shrink-0"/>
            {errorSimulacion}
          </p>
        )}

        {simulacion && (
          <div className="mt-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <Tarjeta label="Cumplen" valor={simulacion.cumple} color="#16a34a" icono={<CheckCircle2 size={14}/>}/>
              <Tarjeta label="No cumplen" valor={simulacion.noCumple} color="#dc2626" icono={<AlertTriangle size={14}/>}/>
              <Tarjeta label="No evaluables" valor={simulacion.noEvaluable} color="#64748b" icono={<HelpCircle size={14}/>}/>
            </div>

            {simulacion.faltantes.length > 0 && (
              <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-micro leading-4 text-slate-500">
                Quedaron sin evaluar por falta de dato:{" "}
                {simulacion.faltantes.map((f) => `${f.cantidad} sin ${f.campo}`).join(", ")}. Un
                cartel sin el dato no cumple ni incumple: falta información.
              </p>
            )}

            {simulacion.porZona.length > 0 && (
              <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[420px] text-left text-tiny">
                  <thead className="bg-slate-50">
                    <tr className="micro-label">
                      <th className="px-3 py-2">Zona</th>
                      <th className="px-3 py-2 text-center">Cumple</th>
                      <th className="px-3 py-2 text-center">No cumple</th>
                      <th className="px-3 py-2 text-center">No evaluable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {simulacion.porZona.map((fila) => (
                      <tr key={fila.zona} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-slate-600">{fila.zona.replace(/_/g, " ")}</td>
                        <td className="px-3 py-2 text-center text-slate-600">{fila.cumple}</td>
                        <td className="px-3 py-2 text-center font-bold text-red-700">{fila.noCumple}</td>
                        <td className="px-3 py-2 text-center text-slate-400">{fila.noEvaluable}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="mt-2 text-micro leading-4 text-slate-400">
              La simulación es un insumo para decidir. No determina que un cartel esté en
              infracción bajo el texto en construcción.
            </p>
          </div>
        )}
      </div>

      {atendiendo && (
        <ConfirmDialog
          title="Atender el diagnóstico"
          description={`${atendiendo.descripcion} El hallazgo no se borra: queda con tu fundamento.`}
          quote={(fundamentos[atendiendo.id] ?? "").trim() || null}
          tone="approve"
          confirmLabel="Atender"
          onConfirm={() => void aplicarAtencion()}
          onCancel={() => setAtendiendo(null)}
        />
      )}
    </div>
  );
}

function Tarjeta({ label, valor, color, icono }: { label: string; valor: number; color: string; icono: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <span className="flex items-center gap-1.5 text-micro font-extrabold uppercase tracking-wider" style={{ color }}>
        {icono}
        {label}
      </span>
      <b className="mt-1 block font-display text-2xl font-extrabold tracking-tight text-ink">{valor}</b>
    </div>
  );
}

function FilaParametro({
  definicion,
  articulo,
  guardado,
  puedeConfirmar,
  onGuardado,
}: {
  definicion: { clave: ClaveParametro; unidad: string; ayuda: string };
  articulo: ArticuloNorma;
  guardado: ParametroGuardado | null;
  puedeConfirmar: boolean;
  onGuardado: () => Promise<void>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState(guardado ? String(guardado.valor) : "");
  const [cita, setCita] = useState(guardado?.cita ?? "");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const confirmar = async () => {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) {
      setError("El valor tiene que ser un número.");
      return;
    }
    // Se valida acá lo mismo que valida PostgreSQL, para que el error se vea
    // antes de enviar y no como un rechazo de la base.
    if (!articulo.texto.includes(cita.trim()) || cita.trim().length < 25) {
      setError("La cita tiene que estar copiada textualmente del artículo (mínimo 25 caracteres).");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const resultado = await confirmarParametro({
        articuloId: articulo.id,
        clave: definicion.clave,
        valor: numero,
        unidad: definicion.unidad,
        cita: cita.trim(),
        fundamento: `Confirmado desde el artículo ${articulo.numero ?? articulo.orden}`,
      });
      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }
      toast(`${PARAMETRO_LABELS[definicion.clave]} confirmada.`);
      setAbierto(false);
      await onGuardado();
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-tiny font-bold text-slate-700">{PARAMETRO_LABELS[definicion.clave]}</span>
        {guardado ? (
          <span className="badge-soft">
            <i style={{ background: "#16a34a" }}/>
            {String(guardado.valor)} {guardado.unidad ?? ""}
          </span>
        ) : (
          <span className="text-micro text-slate-400">sin confirmar</span>
        )}
        {puedeConfirmar && (
          <button
            type="button"
            onClick={() => setAbierto((valor) => !valor)}
            className="secondary-button compact"
          >
            {guardado ? "Corregir" : "Confirmar"}
          </button>
        )}
      </div>

      {abierto && puedeConfirmar && (
        <div className="mt-2 grid gap-2">
          <label className="block">
            <span className="micro-label">Valor ({definicion.unidad}) · {definicion.ayuda}</span>
            <input
              value={valor}
              onChange={(event) => setValor(event.target.value)}
              inputMode="decimal"
              className="mt-1 min-h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-tiny outline-none focus:border-municipal-500"
            />
          </label>
          <label className="block">
            <span className="micro-label">Cita textual del artículo</span>
            <textarea
              value={cita}
              onChange={(event) => setCita(event.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-tiny outline-none focus:border-municipal-500"
              placeholder="Pegá la parte del artículo que fija este valor"
            />
          </label>
          {error && <p role="alert" className="text-micro font-semibold text-red-700">{error}</p>}
          <button
            type="button"
            onClick={confirmar}
            disabled={guardando}
            className="primary-button compact justify-center disabled:opacity-50"
          >
            {guardando ? <Loader2 size={13} className="animate-spin"/> : null}
            Confirmar parámetro
          </button>
        </div>
      )}
    </div>
  );
}
