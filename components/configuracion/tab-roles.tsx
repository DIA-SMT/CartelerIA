"use client";

import { Check, Minus } from "lucide-react";
import { APP_ROLES, PERMISSION_MATRIX, ROLE_LABELS, rolTienePermiso } from "@/lib/roles";

/**
 * Matriz de permisos.
 *
 * No es una tabla escrita a mano: se deriva de `PERMISSION_MATRIX`, que a su vez
 * usa las mismas constantes con las que `AuthProvider` calcula `canInspect` y
 * `canSeeFiscal` y que las migraciones repiten en sus `tiene_rol`. Si alguien
 * cambia un permiso y se olvida de esta pantalla, el test de invariantes falla
 * antes de que la pantalla mienta.
 */
export function TabRoles() {
  return (
    <div>
      <p className="mb-4 max-w-2xl text-tiny leading-5 text-slate-500">
        Qué habilita cada rol. La tabla se deriva de las mismas constantes que aplican los
        permisos en la aplicación y en PostgreSQL, así que no puede quedar desactualizada
        sin que falle una prueba.
      </p>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-left text-tiny">
          <thead className="bg-slate-50">
            <tr className="micro-label">
              <th className="px-3 py-2.5">Acción</th>
              {APP_ROLES.map((rol) => (
                <th key={rol} className="px-3 py-2.5 text-center">{ROLE_LABELS[rol]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_MATRIX.map((fila) => (
              <tr key={fila.accion} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2.5">
                  <b className="block text-ink">{fila.accion}</b>
                  <span className="text-micro leading-4 text-slate-400">{fila.detalle}</span>
                </td>
                {APP_ROLES.map((rol) => {
                  const permitido = rolTienePermiso(fila, rol);
                  return (
                    <td key={rol} className="px-3 py-2.5 text-center">
                      {permitido ? (
                        <span title="Permitido" className="inline-grid size-6 place-items-center rounded-full bg-green-50 text-green-700">
                          <Check size={13} aria-label="Permitido"/>
                        </span>
                      ) : (
                        <span title="No permitido" className="inline-grid size-6 place-items-center rounded-full bg-slate-100 text-slate-400">
                          <Minus size={13} aria-label="No permitido"/>
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-micro font-semibold leading-4 text-amber-800">
        El rol Consulta no accede a empresa, CUIT ni padrón por ninguna vía: lee vistas que
        no tienen esas columnas, y tampoco puede filtrar ni rankear por razón social, porque
        un ranking la reconstruye aunque el campo nunca se muestre.
      </p>
    </div>
  );
}
