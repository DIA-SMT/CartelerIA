"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileSpreadsheet, FolderOpen, Lock, RefreshCw } from "lucide-react";
import { getExpedienteState } from "@/data/expedientes";
import { useAuth } from "@/hooks/use-auth";
import { loadExpedientes, type ExpedienteRecord } from "@/lib/expediente-repository";
import { loadInspections } from "@/lib/inspection-repository";
import { exportExpedientesXlsx } from "@/lib/expediente-report";

export function ExpedientesRegistro() {
  const auth = useAuth();
  const canRead = auth.canRead;

  const [loading, setLoading] = useState(false);
  const [expedientes, setExpedientes] = useState<ExpedienteRecord[]>([]);
  const [conteos, setConteos] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [dataOwnerId, setDataOwnerId] = useState<string | null>(null);
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    if (!canRead) {
      setExpedientes([]);
      setConteos(new Map());
      setError(null);
      setDataOwnerId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setDataOwnerId(null);
    try {
      const [exps, insps] = await Promise.all([loadExpedientes(), loadInspections()]);
      if (sequence !== refreshSequence.current) return;
      const counts = new Map<string, number>();
      for (const insp of insps) counts.set(insp.cartelId, (counts.get(insp.cartelId) ?? 0) + 1);
      setExpedientes(exps);
      setConteos(counts);
      setDataOwnerId(auth.user?.id ?? null);
    } catch {
      if (sequence === refreshSequence.current) {
        setExpedientes([]);
        setConteos(new Map());
        setError("No se pudo verificar el registro de expedientes.");
        setDataOwnerId(auth.user?.id ?? null);
      }
    } finally {
      if (sequence === refreshSequence.current) setLoading(false);
    }
  }, [canRead, auth.user?.id]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshSequence.current += 1;
    };
  }, [refresh]);

  const exportar = () => {
    void exportExpedientesXlsx(expedientes.map((e) => ({ expediente: e, inspecciones: conteos.get(e.cartelId) ?? 0 })));
  };
  const ownsData = dataOwnerId === auth.user?.id;

  // Sección de gestión: sin sesión no aparece (la nav tampoco la ofrece).
  // Un visitante público no necesita ver un candado pidiendo login.
  if (!auth.user) return null;

  return <section id="expedientes" className="section-block">
    <div className="section-heading">
      <div><span className="section-kicker">Gestión</span><h2>Registro de expedientes</h2><p>Legajos administrativos abiertos por cartel. Exportable a Excel.</p></div>
      {canRead && <div className="flex items-center gap-2">
        <button onClick={refresh} className="secondary-button compact" aria-label="Actualizar"><RefreshCw size={14}/></button>
        {ownsData && expedientes.length > 0 && <button onClick={exportar} className="primary-button compact"><FileSpreadsheet size={15}/>Exportar a Excel</button>}
      </div>}
    </div>

    {!canRead ? (
      auth.roleError ? (
        <div className="empty-state border-red-200 bg-red-50"><span><Lock size={22}/></span><h3>Permisos no verificados</h3><p>{auth.roleError}</p><button type="button" onClick={() => void auth.retryRole()} className="secondary-button compact">Reintentar permisos</button></div>
      ) : (
        <TableSkeleton/>
      )
    ) : !ownsData || loading ? (
      <TableSkeleton/>
    ) : error ? (
      <div className="empty-state border-red-200 bg-red-50"><span><FolderOpen size={22}/></span><h3>No se pudo cargar el registro</h3><p>{error} Reintentá o revisá tu sesión.</p></div>
    ) : expedientes.length === 0 ? (
      <div className="empty-state"><span><FolderOpen size={22}/></span><h3>Sin expedientes</h3><p>Todavía no se abrió ningún expediente. Abrí uno desde la ficha de un cartel vinculado.</p></div>
    ) : (
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-left text-[11px]">
          <thead className="bg-slate-50 text-[9px] font-extrabold uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-3 py-2.5">Número</th>
              <th className="px-3 py-2.5">Empresa</th>
              <th className="px-3 py-2.5">Dirección</th>
              <th className="px-3 py-2.5">Estado</th>
              <th className="px-3 py-2.5">Apertura</th>
              <th className="px-3 py-2.5 text-center">Insp.</th>
            </tr>
          </thead>
          <tbody>{expedientes.map((e) => {
            const s = getExpedienteState(e.estado);
            return <tr key={e.id} className="border-t border-slate-100">
              <td className="px-3 py-2 font-bold text-ink">{e.numero}</td>
              <td className="px-3 py-2 text-slate-600">{e.empresa || "—"}</td>
              <td className="max-w-[220px] truncate px-3 py-2 text-slate-500">{e.direccion || "—"}</td>
              <td className="px-3 py-2"><span className="badge-soft"><i style={{ background: s.color }}/>{s.label}</span></td>
              <td className="px-3 py-2 text-slate-500">{new Date(e.createdAt).toLocaleDateString("es-AR")}</td>
              <td className="px-3 py-2 text-center font-bold text-slate-600">{conteos.get(e.cartelId) ?? 0}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    )}
  </section>;
}

function TableSkeleton() {
  return <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3" aria-label="Cargando expedientes">
    <div className="skeleton h-8 rounded-lg"/>
    <div className="skeleton h-9 rounded-lg"/>
    <div className="skeleton h-9 rounded-lg"/>
    <div className="skeleton h-9 rounded-lg"/>
  </div>;
}
