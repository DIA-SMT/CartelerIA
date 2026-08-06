import type { ArticuloNorma } from "./fabrica-repository";

/**
 * Ensamblado del articulado y compuerta de exportación.
 *
 * La lógica vive separada de la generación de archivos para poder probarla: lo
 * que decide si un documento se puede elevar no debería depender de haber
 * abierto un Word.
 */

export interface ArticuloEnsamblado {
  /** Numeración recalculada al ensamblar. El `orden` es lo que manda. */
  numero: number;
  sumilla: string | null;
  texto: string;
  aprobado: boolean;
  articuloId: string;
}

/**
 * Ordena y renumera. Los descartados quedan afuera del documento pero no se
 * borran de la base: siguen siendo antecedente de por qué algo no está.
 */
export function ensamblarArticulado(articulos: ArticuloNorma[]): ArticuloEnsamblado[] {
  return articulos
    .filter((articulo) => articulo.estado !== "descartado")
    .slice()
    .sort((a, b) => a.orden - b.orden)
    .map((articulo, indice) => ({
      numero: indice + 1,
      sumilla: articulo.sumilla,
      texto: articulo.texto,
      aprobado: articulo.estado === "aprobado",
      articuloId: articulo.id,
    }));
}

export interface DiagnosticoPendiente {
  articuloId: string;
  severidad: string;
  atendidoEn: string | null;
}

export interface FaltantePorElevar {
  tipo: "articulo_sin_aprobar" | "diagnostico_grave_sin_atender";
  articuloId: string;
  detalle: string;
}

export interface EvaluacionElevacion {
  puede: boolean;
  faltantes: FaltantePorElevar[];
}

/**
 * Decide si el documento se puede elevar.
 *
 * Fail-closed: si falta algo, no se genera el documento oficial y se dice qué
 * falta, artículo por artículo. Un documento que va al Concejo con artículos
 * sin aprobar o con una contradicción grave sin atender no es un borrador
 * avanzado: es un problema esperando a que alguien lo lea.
 *
 * La versión de trabajo, en cambio, está siempre disponible.
 */
export function evaluarElevacion(
  articulos: ArticuloNorma[],
  diagnosticos: DiagnosticoPendiente[],
): EvaluacionElevacion {
  const faltantes: FaltantePorElevar[] = [];
  const vigentes = articulos.filter((articulo) => articulo.estado !== "descartado");

  if (vigentes.length === 0) {
    return {
      puede: false,
      faltantes: [{
        tipo: "articulo_sin_aprobar",
        articuloId: "",
        detalle: "El proyecto no tiene artículos vigentes.",
      }],
    };
  }

  const ensamblado = ensamblarArticulado(articulos);
  for (const articulo of ensamblado) {
    if (!articulo.aprobado) {
      faltantes.push({
        tipo: "articulo_sin_aprobar",
        articuloId: articulo.articuloId,
        detalle: `El artículo ${articulo.numero} todavía no está aprobado.`,
      });
    }
  }

  // Solo cuentan los diagnósticos de artículos que van en el documento: uno
  // sobre un artículo descartado no bloquea nada.
  const idsVigentes = new Set(vigentes.map((articulo) => articulo.id));
  for (const diagnostico of diagnosticos) {
    if (!idsVigentes.has(diagnostico.articuloId)) continue;
    if (diagnostico.severidad !== "alta" || diagnostico.atendidoEn !== null) continue;
    const numero = ensamblado.find((item) => item.articuloId === diagnostico.articuloId)?.numero;
    faltantes.push({
      tipo: "diagnostico_grave_sin_atender",
      articuloId: diagnostico.articuloId,
      detalle: `El artículo ${numero ?? "?"} tiene un diagnóstico grave sin atender.`,
    });
  }

  return { puede: faltantes.length === 0, faltantes };
}

/** Pie que llevan los dos documentos. Decir cómo se hizo es más defendible. */
export function pieDelDocumento(proyecto: string, oficial: boolean): string {
  const fecha = new Date().toLocaleDateString("es-AR");
  return [
    `${proyecto} · ${oficial ? "Versión para elevar" : "Versión de trabajo"} · ${fecha}`,
    "Texto redactado con asistencia de herramientas automáticas y revisión humana municipal.",
    oficial
      ? "Documento de trabajo institucional. No reemplaza el acto administrativo ni la revisión jurídica aplicable."
      : "BORRADOR: contiene artículos sin aprobar. No utilizar como documento oficial.",
  ].join("\n");
}

// ----------------------------------------------------------------------------
// Observaciones de las áreas
// ----------------------------------------------------------------------------
export interface ObservacionExportable {
  articuloId: string;
  texto: string;
  autorNombre: string | null;
  autorRol: string | null;
  creadoEn: string;
  atendidoEn: string | null;
  fundamento: string | null;
}

export interface FilaObservacion {
  articulo: string;
  sumilla: string;
  observacion: string;
  autor: string;
  rol: string;
  fecha: string;
  estado: string;
  fundamento: string;
}

/**
 * Agrupa las observaciones por artículo, en el orden del articulado.
 *
 * Las de artículos descartados también salen: alguien opinó sobre ese texto y
 * el descarte no borra la opinión. Se marcan como tales para que se entienda
 * por qué el artículo no aparece en el documento.
 */
export function agruparObservaciones(
  articulos: ArticuloNorma[],
  observaciones: ObservacionExportable[],
): FilaObservacion[] {
  const ordenados = articulos.slice().sort((a, b) => a.orden - b.orden);
  const ensamblado = ensamblarArticulado(articulos);
  const numeroFinal = new Map(ensamblado.map((item) => [item.articuloId, item.numero]));

  const filas: FilaObservacion[] = [];
  for (const articulo of ordenados) {
    const propias = observaciones
      .filter((observacion) => observacion.articuloId === articulo.id)
      .slice()
      .sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));
    if (propias.length === 0) continue;

    const numero = numeroFinal.get(articulo.id);
    const etiqueta = numero !== undefined
      ? `Artículo ${numero}`
      : `Artículo ${articulo.numero ?? articulo.orden} (descartado)`;

    for (const observacion of propias) {
      filas.push({
        articulo: etiqueta,
        sumilla: articulo.sumilla ?? "",
        observacion: observacion.texto,
        autor: observacion.autorNombre ?? "Sin identificar",
        rol: observacion.autorRol ?? "",
        fecha: observacion.creadoEn ? observacion.creadoEn.slice(0, 10) : "",
        estado: observacion.atendidoEn ? "Atendida" : "Pendiente",
        fundamento: observacion.fundamento ?? "",
      });
    }
  }
  return filas;
}

/** Registro tabular de las observaciones, con el mismo generador que expedientes. */
export async function exportarObservacionesXlsx(filas: FilaObservacion[]): Promise<void> {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const data = [
    ["Artículo", "Sumilla", "Observación", "Autor", "Rol", "Fecha", "Estado", "Fundamento de atención"],
    ...filas.map((fila) => [
      fila.articulo,
      fila.sumilla,
      fila.observacion,
      fila.autor,
      fila.rol,
      fila.fecha,
      fila.estado,
      fila.fundamento,
    ]),
  ];
  const stamp = new Date().toISOString().slice(0, 10);
  await writeExcelFile(data, {
    columns: [
      { width: 16 },
      { width: 28 },
      { width: 60 },
      { width: 22 },
      { width: 14 },
      { width: 12 },
      { width: 12 },
      { width: 40 },
    ],
    sheet: "Observaciones",
  }).toFile(`observaciones-${stamp}.xlsx`);
}

/**
 * Genera el Word.
 *
 * Carga diferida: la librería se descarga solo cuando alguien exporta, igual
 * que el generador de XLSX del registro de expedientes. Se genera en el
 * navegador y no en una ruta: `docx` es JavaScript puro y determinístico, así
 * que sumar una función serverless para esto no aporta nada.
 */
export async function exportarArticuladoWord(input: {
  proyecto: string;
  articulos: ArticuloEnsamblado[];
  oficial: boolean;
}): Promise<void> {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun, AlignmentType } = await import("docx");

  const encabezado: InstanceType<typeof Paragraph>[] = [
    new Paragraph({
      text: "Municipalidad de San Miguel de Tucumán",
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      text: input.proyecto,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
    }),
  ];

  if (!input.oficial) {
    encabezado.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "BORRADOR — VERSIÓN DE TRABAJO", bold: true })],
    }));
  }

  const cuerpo = input.articulos.flatMap((articulo) => {
    const titulo = `Artículo ${articulo.numero}.—${articulo.sumilla ? ` ${articulo.sumilla}` : ""}`;
    const parrafos = [
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: titulo, bold: true })],
      }),
    ];
    // Los artículos sin aprobar se señalan en el propio documento: quien lo
    // lea impreso tiene que poder verlo sin volver al sistema.
    if (!articulo.aprobado) {
      parrafos.push(new Paragraph({
        children: [new TextRun({ text: "[ARTÍCULO SIN APROBAR]", bold: true, italics: true })],
      }));
    }
    parrafos.push(new Paragraph({ text: articulo.texto }));
    return parrafos;
  });

  const pie = pieDelDocumento(input.proyecto, input.oficial)
    .split("\n")
    .map((linea) => new Paragraph({ children: [new TextRun({ text: linea, size: 16 })] }));

  const documento = new Document({
    sections: [{
      children: [
        ...encabezado,
        new Paragraph({ text: "" }),
        ...cuerpo,
        new Paragraph({ text: "" }),
        ...pie,
      ],
    }],
  });

  const blob = await Packer.toBlob(documento);
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = `${input.oficial ? "ordenanza" : "borrador"}-${new Date().toISOString().slice(0, 10)}.docx`;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}
