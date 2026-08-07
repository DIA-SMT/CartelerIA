"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, ScanSearch, ShieldQuestion } from "lucide-react";
import {
  MOTIVO_ASISTENTE,
  revisarContraProyecto,
  type ArticuloNorma,
  type RevisionProyecto,
} from "@/lib/fabrica-repository";

const SEVERIDAD_COLORS: Record<string, string> = {
  alta: "#dc2626",
  media: "#f59e0b",
  baja: "#64748b",
};

const TIPO_LABELS: Record<string, string> = {
  contradiccion: "se contradicen",
  repeticion: "dicen lo mismo",
  termino_sin_definir: "término sin definir",
};

/**
 * Revisa el artículo contra los otros del mismo documento.
 *
 * No guarda nada ni bloquea nada: es un par de ojos más, no una compuerta. Lo
 * que devuelve se lee y se decide, y si no hay nada que decir lo dice también
 * —una lista vacía es la respuesta normal, no una falla—.
 *
 * Cada hallazgo cita textualmente el artículo con el que choca, y esa cita se
 * verifica contra los artículos antes de mostrarse: si el modelo la inventó, no
 * llega hasta acá.
 */
export function RevisorProyecto({ articulo, texto }: { articulo: ArticuloNorma; texto: string }) {
  const [revision, setRevision] = useState<RevisionProyecto | null>(null);
  const [revisando, setRevisando] = useState(false);

  // Cambiar de artículo limpia lo anterior: mostrar los hallazgos de otro
  // artículo sería peor que no mostrar nada.
  useEffect(() => { setRevision(null); }, [articulo.id]);

  const revisar = async () => {
    if (revisando) return;
    setRevisando(true);
    try {
      setRevision(await revisarContraProyecto(articulo.id, texto));
    } finally {
      setRevisando(false);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="micro-label">Revisión contra el resto del documento</span>
          <p className="mt-0.5 text-micro leading-4 text-slate-500">
            Busca si este artículo choca, repite o usa un término que ningún otro define.
          </p>
        </div>
        <button
          type="button"
          onClick={revisar}
          disabled={revisando || texto.trim().length < 20}
          className="secondary-button compact disabled:cursor-not-allowed disabled:opacity-50"
        >
          {revisando ? <Loader2 size={13} className="animate-spin"/> : <ScanSearch size={13}/>}
          Revisar
        </button>
      </div>

      {revision?.error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-micro font-semibold text-red-800">
          {revision.error}
        </p>
      )}

      {revision?.ok && !revision.asistido && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-micro leading-4 text-amber-800">
          <ShieldQuestion size={12} className="mt-0.5 shrink-0"/>
          {MOTIVO_ASISTENTE[revision.motivo ?? ""] ?? "El asistente no pudo revisar el artículo."}
        </p>
      )}

      {revision?.ok && revision.asistido && revision.hallazgos.length === 0 && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-green-50 px-3 py-2 text-micro leading-4 text-green-800">
          <CheckCircle2 size={12} className="mt-0.5 shrink-0"/>
          {revision.comparados === 0
            ? "Ningún otro artículo habla de lo mismo, así que no hay con qué compararlo."
            : `Sin choques con los ${revision.comparados} artículos más parecidos.`}
          {revision.descartados > 0 && ` Se descartaron ${revision.descartados} hallazgos que citaban algo que no existe.`}
        </p>
      )}

      {revision && revision.hallazgos.length > 0 && (
        <>
          <ul className="mt-3 space-y-2">
            {revision.hallazgos.map((hallazgo, indice) => (
              <li key={indice} className="rounded-xl border border-amber-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="badge-soft">
                    <i style={{ background: SEVERIDAD_COLORS[hallazgo.severidad] ?? "#64748b" }}/>
                    {TIPO_LABELS[hallazgo.tipo] ?? hallazgo.tipo.replace(/_/g, " ")}
                  </span>
                  {hallazgo.referencia && (
                    <span className="text-micro font-bold text-slate-600">{hallazgo.referencia}</span>
                  )}
                  <span className="text-micro text-slate-400">confianza {hallazgo.confianza}</span>
                </div>
                <p className="mt-1.5 text-tiny leading-5 text-slate-700">{hallazgo.descripcion}</p>
                {hallazgo.cita && (
                  <blockquote className="mt-1.5 border-l-2 border-slate-300 pl-2 text-micro italic leading-4 text-slate-500">
                    “{hallazgo.cita}”
                  </blockquote>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-micro leading-4 text-slate-400">
            Comparado contra {revision.comparados} artículos. Esto no bloquea nada: decidís vos.
          </p>
        </>
      )}
    </div>
  );
}
