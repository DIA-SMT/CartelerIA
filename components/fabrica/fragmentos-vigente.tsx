"use client";

import { EyeOff } from "lucide-react";
import type { FragmentoRecuperado } from "@/lib/fabrica-repository";

/**
 * Los fragmentos de la normativa vigente que trajo la búsqueda, diciendo cuáles
 * llegaron al modelo y cuáles no.
 *
 * El asistente solo recibe los fragmentos de documentos habilitados para salir
 * del municipio. Eso significa que puede contestar "sin hallazgos" porque no
 * vio el documento donde estaba el conflicto. Callarlo convertiría una
 * limitación de permisos en un certificado de que no hay problemas, que es
 * justo lo contrario de lo que pasó.
 *
 * Por eso los no vistos van primero y se muestran igual: no se pudieron mandar
 * afuera, pero se pueden leer acá.
 */
export function FragmentosVigente({
  fragmentos,
  asistido,
}: {
  fragmentos: FragmentoRecuperado[];
  /** Si el modelo no intervino, no hay nada que aclarar sobre lo que vio. */
  asistido: boolean;
}) {
  if (fragmentos.length === 0) return null;
  const sinVer = fragmentos.filter((fragmento) => !fragmento.visto);
  const vistos = fragmentos.length - sinVer.length;

  return (
    <>
      {asistido && sinVer.length > 0 && (
        <p
          role="status"
          className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-micro leading-4 text-amber-900"
        >
          <EyeOff size={12} className="mt-0.5 shrink-0"/>
          <span>
            <b>El asistente no vio {sinVer.length} de los {fragmentos.length} fragmentos</b> porque
            esos documentos no están habilitados para salir del municipio. Si no encontró
            hallazgos, no quiere decir que no haya conflicto: quiere decir que miró{" "}
            {vistos === 1 ? "un solo fragmento" : `${vistos} fragmentos`}. Los otros están
            acá abajo para leerlos.
          </span>
        </p>
      )}

      <details className="mt-2 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
        <summary className="cursor-pointer text-micro font-extrabold uppercase tracking-wider text-slate-500">
          Normativa vigente relacionada ({fragmentos.length})
        </summary>
        <ul className="mt-2 space-y-2">
          {[...sinVer, ...fragmentos.filter((fragmento) => fragmento.visto)].map((fragmento, indice) => (
            <li key={indice} className="rounded-lg bg-white p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="micro-label">
                  {fragmento.titulo}{fragmento.seccion ? ` · ${fragmento.seccion}` : ""}
                </span>
                {asistido && (
                  <span className="badge-soft">
                    <i style={{ background: fragmento.visto ? "#16a34a" : "#f59e0b" }}/>
                    {fragmento.visto ? "Lo vio el asistente" : "No salió del municipio"}
                  </span>
                )}
              </div>
              <p className="mt-1 text-micro leading-4 text-slate-600">{fragmento.contenido}</p>
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
