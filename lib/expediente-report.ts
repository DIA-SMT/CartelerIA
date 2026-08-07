// ============================================================================
// Reportes de expedientes (Fase 6.3)
//  - PDF: dossier imprimible del expediente vía window.print() (sin dependencia).
//  - Excel: registro tabular .xlsx con write-excel-file.
// ============================================================================

import { getExpedienteState } from "@/data/expedientes";
import { getInspectionState } from "@/data/inspections";
import {
  APPROVAL_STATUS_LABELS,
  stateChangeLabel,
  type StateChangeRequest,
} from "@/data/approvals";
import type {
  ExpedienteDocumento,
  ExpedienteHistoryEntry,
  ExpedienteRecord,
} from "./expediente-repository";
import type { InspectionRecord } from "./inspection-repository";
import { RESTRICTED_BY_ROLE_LABEL } from "./roles";

/**
 * Un informe exportado sobrevive a la sesión que lo generó: si la interfaz le
 * oculta la razón social a un rol consultivo pero el Excel la incluye, la
 * restricción no existe. Cuando la sesión no tiene permiso fiscal, el campo se
 * declara restringido en vez de omitirse en silencio.
 */
function empresaParaInforme(empresa: string | null, includeFiscalData: boolean): string {
  if (!includeFiscalData) return RESTRICTED_BY_ROLE_LABEL;
  return empresa || "—";
}

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
  requests: StateChangeRequest[];
  documentos: ExpedienteDocumento[];
  /** false en sesiones sin permiso fiscal: el dossier no lleva razón social. */
  includeFiscalData: boolean;
}

function buildDossierHtml({
  expediente,
  cartelName,
  inspecciones,
  historial,
  requests,
  documentos,
  includeFiscalData,
}: DossierData): string {
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
        const actor = [h.changedByName, h.changedByRole ? `(${h.changedByRole})` : null]
          .filter(Boolean)
          .join(" ");
        return `<tr><td>${fecha(h.createdAt)}</td><td>${esc(from)}</td><td>${esc(to.label)}</td><td>${esc(actor || "—")}</td><td>${esc(h.nota || "—")}</td></tr>`;
      }).join("")
    : `<tr><td colspan="5" class="muted">Sin movimientos.</td></tr>`;

  const approvalRows = requests.length
    ? requests.map((request) => {
        const requester = [
          request.requesterName || request.requestedBy,
          request.requesterRole ? `(${request.requesterRole})` : null,
        ].filter(Boolean).join(" ");
        const resolver = request.resolvedBy
          ? [
              request.resolverName || request.resolvedBy,
              request.resolverRole ? `(${request.resolverRole})` : null,
            ].filter(Boolean).join(" ")
          : "—";
        return `<tr>
          <td>${fecha(request.createdAt)}</td>
          <td>${esc(stateChangeLabel(request, "previous"))} → ${esc(stateChangeLabel(request, "requested"))}</td>
          <td>${esc(request.reason)}</td>
          <td>${esc(requester)}</td>
          <td>${esc(APPROVAL_STATUS_LABELS[request.status])}</td>
          <td>${esc(resolver)}</td>
          <td>${esc(request.resolutionNote || "—")}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="7" class="muted">Sin solicitudes de aprobación registradas.</td></tr>`;

  const documentRows = documentos.length
    ? documentos.map((documento) => {
        const verified = Boolean(
          documento.sha256
          && documento.byteSize
          && documento.mimeType
          && documento.uploadedBy,
        );
        return `<tr>
          <td>${fecha(documento.createdAt)}</td>
          <td>${esc(documento.descripcion || documento.storagePath.split("/").pop() || "Documento")}</td>
          <td>${esc(documento.mimeType || documento.tipo || "—")}</td>
          <td>${documento.byteSize != null ? esc(documento.byteSize) : "—"}</td>
          <td class="hash">${esc(documento.sha256 || "—")}</td>
          <td>${verified ? "Verificada" : "Histórica no verificada"}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="6" class="muted">Sin documentos incorporados.</td></tr>`;

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
  .hash { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 8px; overflow-wrap: anywhere; }
  .warning { border: 1px solid #fde68a; background: #fffbeb; color: #92400e; padding: 8px; border-radius: 6px; }
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
    <div><b>Empresa:</b> ${esc(empresaParaInforme(expediente.empresa, includeFiscalData))}</div>
    <div><b>Dirección:</b> ${esc(expediente.direccion || "—")}</div>
    <div><b>Estado:</b> ${esc(estado.label)}</div>
    <div><b>Apertura:</b> ${fecha(expediente.createdAt)}</div>
    <div><b>Cierre:</b> ${fecha(expediente.cerradoEn)}</div>
  </div>

  <h2>Inspecciones (${inspecciones.length})</h2>
  <table><thead><tr><th>Fecha</th><th>Estado</th><th>Superficie</th><th>Observaciones</th></tr></thead><tbody>${inspRows}</tbody></table>

  <h2>Historial de estados</h2>
  <table><thead><tr><th>Fecha</th><th>De</th><th>A</th><th>Actor</th><th>Nota</th></tr></thead><tbody>${histRows}</tbody></table>

  <h2>Solicitudes y resoluciones administrativas</h2>
  <table><thead><tr><th>Fecha</th><th>Cambio</th><th>Fundamento</th><th>Solicitante</th><th>Estado</th><th>Resolutor</th><th>Nota</th></tr></thead><tbody>${approvalRows}</tbody></table>

  <h2>Documentos y huellas de integridad</h2>
  <table><thead><tr><th>Fecha</th><th>Documento</th><th>MIME</th><th>Bytes</th><th>SHA-256</th><th>Verificación</th></tr></thead><tbody>${documentRows}</tbody></table>
  <p class="warning">Los archivos marcados como históricos no verificados fueron incorporados antes del control de huella y no deben presentarse como evidencia criptográficamente verificada.</p>

  <h2>Observaciones</h2>
  <p>${esc(expediente.observaciones || "—")}</p>

  <div class="foot">Emitido el ${esc(emitido)} · Documento interno de apoyo. No reemplaza el acto administrativo, la firma de la autoridad competente ni la revisión jurídica aplicable.</div>
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

export async function exportExpedientesXlsx(
  rows: ExpedienteRegistroRow[],
  includeFiscalData: boolean,
): Promise<void> {
  // Carga diferida: el generador se descarga solo cuando el usuario exporta.
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const data = [
    ["Número", "Empresa", "Dirección", "Estado", "Apertura", "Cierre", "Inspecciones", "Observaciones"],
    ...rows.map(({ expediente, inspecciones }) => [
      expediente.numero || "",
      includeFiscalData ? expediente.empresa || "" : RESTRICTED_BY_ROLE_LABEL,
      expediente.direccion || "",
      getExpedienteState(expediente.estado).label,
      fecha(expediente.createdAt),
      fecha(expediente.cerradoEn),
      inspecciones,
      expediente.observaciones || "",
    ]),
  ];
  const stamp = new Date().toISOString().slice(0, 10);
  await writeExcelFile(data, {
    columns: [
      { width: 15 },
      { width: 26 },
      { width: 30 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
      { width: 40 },
    ],
    sheet: "Expedientes",
  }).toFile(`expedientes-${stamp}.xlsx`);
}
