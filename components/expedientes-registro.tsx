"use client";

import { useCallback, useEffect, useState } from "react";
import { FileSpreadsheet, FolderOpen, Loader2, Lock, RefreshCw } from "lucide-react";
import { getExpedienteState } from "@/data/expedientes";
import { useAuth } from "@/hooks/use-auth";
import { loadExpedientes, type ExpedienteRecord } from "@/lib/expediente-repository";
import { loadInspections } from "@/lib/inspection-repository";
import { exportExpedientesXlsx } from "@/lib/expediente-report";

export function ExpedientesRegistro() {
  const auth = useAuth();
  const canRead = auth.available && Boolean(auth.user);

  const [loading, setLoading] = useState(false);
  const [expedientes, setExpedientes] = useState<ExpedienteRecord[]>([]);
  const [conteos, setConteos] = useState<Map<string, number>>(new Map());

  const refresh = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    const [exps, insps] = await Promise.all([loadExpedientes(), loadInspections()]);
    const counts = new Map<string, number>();
    for (const insp of insps) counts.set(insp.cartelId, (counts.get(insp.cartelId) ?? 0) + 1);
    setExpedientes(exps);
    setConteos(counts);
    setLoading(false);
  }, [canRead]);

  useEffect(() => { void refresh(); }, [refresh]);

  const exportar = () => {
    void exportExpedientesXlsx(expedientes.map((e) => ({ expediente: e, inspecciones: conteos.get(e.cartelId) ?? 0 })));
  };

  return <section id="expedientes" className="section-block">
    <div className="section-heading">
      <div><span className="section-kicker">Gestión</span><h2>Registro de expedientes</h2><p>Legajos administrativos abiertos por cartel. Exportable a Excel.</p></div>
      {canRead && expedientes.length > 0 && <div className="flex items-center gap-2">
        <button onClick={refresh} className="secondary-button compact" aria-label="Actualizar"><RefreshCw size={14}/></button>
        <button onClick={exportar} className="primary-button compact"><FileSpreadsheet size={15}/>Exportar a Excel</button>
      </div>}
    </div>

    {!canRead ? (
      <div className="empty-state"><span><Lock size={22}/></span><h3>Requiere sesión</h3><p>Ingresá con tu cuenta municipal para ver el registro de expedientes.</p></div>
    ) : loading ? (
      <div className="grid min-h-40 place-items-center rounded-2xl border border-slate-200 bg-white"><Loader2 size={24} className="animate-spin text-municipal-600"/></div>
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
              <td className="px-3 py-2"><span className="inline-flex rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase text-white" style={{ background: s.color }}>{s.label}</span></td>
              <td className="px-3 py-2 text-slate-500">{new Date(e.createdAt).toLocaleDateString("es-AR")}</td>
              <td className="px-3 py-2 text-center font-bold text-slate-600">{conteos.get(e.cartelId) ?? 0}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    )}
  </section>;
}
