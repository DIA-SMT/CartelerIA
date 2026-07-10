// ============================================================================
// Reportes de expedientes (Fase 6.3)
//  - PDF: dossier imprimible del expediente vía window.print() (sin dependencia).
//  - Excel: registro tabular .xlsx con SheetJS.
// ============================================================================

import { getExpedienteState } from "@/data/expedientes";
import { getInspectionState } from "@/data/inspections";
import type { ExpedienteHistoryEntry, ExpedienteRecord } from "./expediente-repository";
import type { InspectionRecord } from "./inspection-repository";

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
}

function fecha(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("es-AR") : "—";
}

// ----------------------------------------------------------------------------
// PDF — dossier imprimible
// ----------------------------------------------------------------------------
export interface DossierData {
  expediente: ExpedienteRecord;
  cartelName: string;
  inspecciones: InspectionRecord[];
  historial: ExpedienteHistoryEntry[];
}

function buildDossierHtml({ expediente, cartelName, inspecciones, historial }: DossierData): string {
  const estado = getExpedienteState(expediente.estado);
  const emitido = new Date().toLocaleString("es-AR");

  const inspRows = inspecciones.length
    ? inspecciones.map((i) => {
        const s = getInspectionState(i.estado);
        return `<tr><td>${fecha(i.createdAt)}</td><td>${esc(s.label)}</td><td>${i.superficieM2 != null ? esc(i.superficieM2) + " m²" : "—"}</td><td>${esc(i.observaciones || "—")}</td></tr>`;
      }).join("")
    : `<tr><td colspan="4" class="muted">Sin inspecciones registradas.</td></tr>`;

  const histRows = historial.length
    ? historial.map((h) => {
        const to = getExpedienteState(h.estadoNuevo);
        const from = h.estadoAnterior ? getExpedienteState(h.estadoAnterior).label : "—";
        return `<tr><td>${fecha(h.createdAt)}</td><td>${esc(from)}</td><td>${esc(to.label)}</td></tr>`;
      }).join("")
    : `<tr><td colspan="3" class="muted">Sin movimientos.</td></tr>`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(expediente.numero || "Expediente")}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; margin: 32px; font-size: 12px; }
  h1 { font-size: 18px; margin: 0; }
  .kicker { text-transform: uppercase; letter-spacing: .12em; font-size: 9px; font-weight: 800; color: #64748b; }
  .head { border-bottom: 2px solid #0166FF; padding-bottom: 10px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-end; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 999px; color: #fff; font-size: 10px; font-weight: 800; text-transform: uppercase; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #0166FF; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin: 18px 0 8px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  th { font-size: 9px; text-transform: uppercase; color: #64748b; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; }
  .grid div { padding: 3px 0; border-bottom: 1px solid #f1f5f9; }
  .grid b { color: #64748b; font-weight: 700; }
  .muted { color: #94a3b8; }
  .foot { margin-top: 24px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #94a3b8; }
  @media print { body { margin: 12mm; } }
</style></head><body>
  <div class="head">
    <div><span class="kicker">Municipalidad de San Miguel de Tucumán · Expediente</span><h1>${esc(expediente.numero || "Expediente")}</h1></div>
    <span class="badge" style="background:${estado.color}">${esc(estado.label)}</span>
  </div>

  <h2>Datos del expediente</h2>
  <div class="grid">
    <div><b>Cartel:</b> ${esc(cartelName)}</div>
    <div><b>Empresa:</b> ${esc(expediente.empresa || "—")}</div>
    <div><b>Dirección:</b> ${esc(expediente.direccion || "—")}</div>
    <div><b>Estado:</b> ${esc(estado.label)}</div>
    <div><b>Apertura:</b> ${fecha(expediente.createdAt)}</div>
    <div><b>Cierre:</b> ${fecha(expediente.cerradoEn)}</div>
  </div>

  <h2>Inspecciones (${inspecciones.length})</h2>
  <table><thead><tr><th>Fecha</th><th>Estado</th><th>Superficie</th><th>Observaciones</th></tr></thead><tbody>${inspRows}</tbody></table>

  <h2>Historial de estados</h2>
  <table><thead><tr><th>Fecha</th><th>De</th><th>A</th></tr></thead><tbody>${histRows}</tbody></table>

  <h2>Observaciones</h2>
  <p>${esc(expediente.observaciones || "—")}</p>

  <div class="foot">Emitido el ${esc(emitido)} · Documento interno de gestión.</div>
</body></html>`;
}

/** Abre el dossier en un iframe oculto y dispara la impresión (Guardar como PDF). */
export function printExpedienteDossier(data: DossierData): void {
  const html = buildDossierHtml(data);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) { document.body.removeChild(iframe); return; }
  doc.open();
  doc.write(html);
  doc.close();
  window.setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    window.setTimeout(() => document.body.removeChild(iframe), 1500);
  }, 350);
}

// ----------------------------------------------------------------------------
// Excel — registro tabular
// ----------------------------------------------------------------------------
export interface ExpedienteRegistroRow {
  expediente: ExpedienteRecord;
  inspecciones: number;
}

export async function exportExpedientesXlsx(rows: ExpedienteRegistroRow[]): Promise<void> {
  // Carga diferida de SheetJS: solo se descarga al exportar, no en el bundle inicial.
  const XLSX = await import("xlsx");
  const data = rows.map(({ expediente, inspecciones }) => ({
    "Número": expediente.numero || "",
    Empresa: expediente.empresa || "",
    Dirección: expediente.direccion || "",
    Estado: getExpedienteState(expediente.estado).label,
    Apertura: fecha(expediente.createdAt),
    Cierre: fecha(expediente.cerradoEn),
    Inspecciones: inspecciones,
    Observaciones: expediente.observaciones || "",
  }));
  const worksheet = XLSX.utils.json_to_sheet(data);
  worksheet["!cols"] = [{ wch: 15 }, { wch: 26 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 40 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Expedientes");
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `expedientes-${stamp}.xlsx`);
}
