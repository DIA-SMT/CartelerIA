export type PotentialPiiKind =
  | "email"
  | "cuit_cuil"
  | "dni"
  | "telefono"
  | "domicilio"
  | "padron"
  | "expediente"
  | "nombre_personal"
  | "dato_bancario";

const PII_PATTERNS: ReadonlyArray<{
  kind: PotentialPiiKind;
  pattern: RegExp;
}> = [
  {
    kind: "email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  },
  {
    kind: "cuit_cuil",
    pattern: /\b(?:20|23|24|27|30|33|34)[.\s-]?\d{8}[.\s-]?\d\b/,
  },
  {
    kind: "cuit_cuil",
    pattern: /\b(?:cuit|cuil)\s*(?:n(?:ro|[°º])?\.?\s*)?[:#-]?\s*(?:\d[.\s-]?){10}\d\b/i,
  },
  {
    kind: "dni",
    pattern: /\b(?:dni|documento(?:\s+nacional)?(?:\s+de\s+identidad)?)\s*(?:n(?:ro|[°º])?\.?\s*)?[:#-]?\s*(?:\d[.\s]?){6,7}\d\b/i,
  },
  {
    kind: "telefono",
    pattern: /\b(?:tel[eé]fono|celular|whatsapp)\s*[:#-]?\s*(?:\+?\d[\s().-]?){6,15}\b/i,
  },
  {
    kind: "telefono",
    pattern: /\+54\s*(?:9\s*)?(?:\(?\d{2,4}\)?[\s.-]*)?\d(?:[\s.-]?\d){5,9}\b/,
  },
  {
    kind: "domicilio",
    pattern: /\b(?:domicilio(?:\s+(?:real|particular|comercial|constituido))?|direcci[oó]n\s+particular)\s*[:#-]\s*\S.{2,}/i,
  },
  {
    kind: "domicilio",
    pattern: /\b(?:vive|reside|domiciliad[oa])\s+en\s+[a-záéíóúüñ][a-záéíóúüñ\s.'-]{1,60}\s+\d{1,5}\b/i,
  },
  {
    kind: "domicilio",
    pattern: /\b(?:calle|av(?:enida)?\.?|pasaje|pje\.?|ruta)\s+[a-záéíóúüñ][a-záéíóúüñ\s.'-]{1,60}\s+\d{1,5}\b/i,
  },
  {
    kind: "padron",
    pattern: /\bpadr[oó]n\s*(?:n(?:ro|[.°º])*\s*)?[:#-]?\s*[a-z]?\d[\w./-]{2,}\b/i,
  },
  {
    kind: "expediente",
    pattern: /\b(?:exp(?:ediente)?|actuaci[oó]n)\s*(?:n(?:ro|[.°º])*\s*)?[:#-]?\s*[a-z]?\d[\w./-]{2,}\b/i,
  },
  {
    kind: "nombre_personal",
    pattern: /\b(?:nombre\s+y\s+apellido|persona|titular)\s*[:#-]\s*[a-záéíóúñ]+(?:\s+[a-záéíóúñ]+)+/i,
  },
  {
    kind: "nombre_personal",
    pattern: /\b(?:[Ss]r\.?|[Ss]ra\.?|[Ss]eñor|[Ss]eñora)\s+[A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ'-]+(?:\s+[A-ZÁÉÍÓÚÜÑ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ'-]+)+/,
  },
  {
    kind: "dato_bancario",
    pattern: /\b(?:cbu|cvu|alias\s+bancario|tarjeta)\s*[:#-]?\s*[a-z0-9][a-z0-9.\s-]{5,}/i,
  },
];

/**
 * Detección conservadora de identificadores personales explícitos.
 *
 * No intenta inferir identidades a partir de lenguaje libre. Su objetivo es
 * impedir que preguntas o fragmentos con identificadores evidentes salgan del
 * entorno antes de invocar un proveedor de IA externo.
 */
export function findPotentialPii(...texts: Array<string | null | undefined>): PotentialPiiKind[] {
  const combined = texts.filter((text): text is string => Boolean(text)).join("\n");
  const found = new Set<PotentialPiiKind>();
  for (const { kind, pattern } of PII_PATTERNS) {
    if (pattern.test(combined)) found.add(kind);
  }
  return Array.from(found);
}

export function hasPotentialPii(...texts: Array<string | null | undefined>): boolean {
  return findPotentialPii(...texts).length > 0;
}

/**
 * Valida las referencias generadas por un LLM.
 *
 * Una respuesta aceptable debe incluir al menos una marca `[n]`, no puede
 * contener corchetes malformados y cada número debe apuntar a una cita
 * recuperada en el rango 1..citationCount.
 */
export function parseCitationReferences(
  answer: string,
  citationCount: number,
): number[] | null {
  if (!Number.isInteger(citationCount) || citationCount < 1 || answer.trim().length === 0) {
    return null;
  }

  const markers = Array.from(answer.matchAll(/\[([^\[\]]*)\]/g));
  if (markers.length === 0) return null;

  const withoutMarkers = answer.replace(/\[[^\[\]]*\]/g, "");
  if (withoutMarkers.includes("[") || withoutMarkers.includes("]")) return null;

  const references: number[] = [];
  const seen = new Set<number>();
  for (const marker of markers) {
    const raw = marker[1];
    if (!/^[1-9]\d*$/.test(raw)) return null;
    const reference = Number(raw);
    if (
      !Number.isSafeInteger(reference)
      || reference < 1
      || reference > citationCount
    ) return null;
    if (!seen.has(reference)) {
      seen.add(reference);
      references.push(reference);
    }
  }

  return references;
}
