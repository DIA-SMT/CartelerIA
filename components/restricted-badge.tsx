import { Lock } from "lucide-react";
import { RESTRICTED_BY_ROLE_LABEL } from "@/lib/roles";

/**
 * Marca un dato que existe y esta sesión no puede ver.
 *
 * Deliberadamente no es un guion ni un campo vacío: quien consulta tiene que
 * poder distinguir "el municipio no tiene este dato" de "vos no tenés acceso a
 * este dato". Lo segundo es una decisión administrativa, no un faltante.
 */
export function RestrictedByRole({ className = "" }: { className?: string }) {
  return (
    <span
      className={`badge-soft ${className}`}
      title="El dato existe en el registro. Tu rol no tiene acceso."
    >
      <Lock size={9} className="shrink-0 text-slate-500" aria-hidden />
      {RESTRICTED_BY_ROLE_LABEL}
    </span>
  );
}
