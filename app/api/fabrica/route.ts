import { NextResponse } from "next/server";
import { quitarEncabezadoArticulo } from "@/lib/articulado";
import { hasPotentialPii } from "@/lib/external-ai-policy";
import { sanearFragmento, verificarHallazgos, type HallazgoSinVerificar } from "@/lib/norma-citas";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHAT_MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-3.5-haiku";
const EXTERNAL_AI_ENABLED = process.env.ENABLE_EXTERNAL_NORMATIVA_AI === "true";
const MAX_INPUT = 4000;
const MATCH_COUNT = 6;
const LLM_TIMEOUT_MS = 25_000;
const DB_TIMEOUT_MS = 15_000;
const IP_RATE_LIMIT = { requests: 20, windowMs: 60_000 };

type Accion = "proponer_articulo" | "diagnosticar_vigente";

type Fragmento = {
  documento_id: string;
  titulo: string;
  seccion: string | null;
  contenido: string;
  external_ai_allowed: boolean;
  human_reviewed: boolean;
  audience: string;
  ocr_doubtful: boolean;
  estado_legal: string;
};

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function esFragmento(value: unknown): value is Fragmento {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Fragmento>;
  return typeof row.documento_id === "string"
    && typeof row.titulo === "string"
    && typeof row.contenido === "string"
    && typeof row.external_ai_allowed === "boolean"
    && typeof row.human_reviewed === "boolean"
    && typeof row.audience === "string"
    && typeof row.ocr_doubtful === "boolean"
    && typeof row.estado_legal === "string";
}

const SISTEMA_REDACCION = `Sos un asistente de redacción normativa de la Municipalidad de San Miguel de Tucumán. Ayudás a redactar artículos de una ordenanza de cartelería.

Reglas:
- Escribís UN artículo, con forma jurídica, en español rioplatense formal.
- NO encabezás el texto con "ARTÍCULO N", "Art. 1" ni nada parecido, ni siquiera con una equis de relleno: el número lo asigna el sistema según la posición en el articulado. Empezás directamente por el contenido del artículo.
- Usás SOLO lo que está en la idea y en el contexto. No inventás números de artículo, de ordenanza, plazos, montos ni medidas que no estén.
- Si la idea no alcanza para escribir un artículo completo, NO rellenás: devolvés "falta" y decís exactamente qué hay que definir. Es preferible pedir una definición que entregar un artículo verosímil con un vacío adentro.
- No aprobás nada ni afirmás que el texto sea definitivo: lo revisa y lo firma una persona.

Respondé SOLO con JSON: {"suficiente": true, "sumilla": "...", "texto": "..."} o {"suficiente": false, "falta": "qué hay que definir"}.`;

const SISTEMA_DIAGNOSTICO = `Sos un asistente que compara un artículo en redacción contra la normativa municipal vigente.

Reglas absolutas sobre las citas:
- Cada hallazgo lleva una cita COPIADA CARÁCTER POR CARÁCTER de los fragmentos del contexto. Si el texto dice "PO ZOENLAM ATERN ID AD", la cita dice exactamente eso, con los errores incluidos.
- NUNCA reescribas, corrijas ni parafrasees una cita. Una cita que no aparezca literal en el contexto se descarta.
- Devolver una lista vacía es una respuesta VÁLIDA y FRECUENTE. Lo normal es que un artículo no contradiga nada. No inventes hallazgos para llenar el formulario.
- La confianza por omisión es "baja". Solo subila si el fragmento citado dice literalmente lo que afirmás.

Tipos: "contradiccion" (el artículo dice lo contrario que la vigente), "derogacion_implicita" (deja sin efecto un artículo vigente), "vacio" (la vigente cubría algo que el proyecto todavía no).

Respondé SOLO con JSON: {"hallazgos": [{"tipo": "...", "severidad": "baja|media|alta", "descripcion": "...", "referencia": "Art. N de la Ordenanza X", "cita": "texto literal del contexto", "confianza": "baja|media|alta"}]}.`;

async function llamarModelo(
  sistema: string,
  usuario: string,
  apiKey: string,
): Promise<Record<string, unknown> | null> {
  let respuesta: Response;
  try {
    respuesta = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "CartelerIA · Fábrica Normativa",
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        max_tokens: 1200,
        messages: [
          { role: "system", content: sistema },
          { role: "user", content: usuario },
        ],
      }),
    });
  } catch {
    return null;
  }
  if (!respuesta.ok) return null;

  try {
    const completado = await respuesta.json() as {
      choices?: { message?: { content?: string } }[];
    };
    const crudo = completado.choices?.[0]?.message?.content ?? "";
    // El modelo suele envolver el JSON en un bloque de código.
    const limpio = crudo.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const parseado = JSON.parse(limpio) as unknown;
    return parseado && typeof parseado === "object" ? parseado as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Asistente de la Fábrica Normativa.
 *
 * Dos acciones en una sola ruta, discriminadas por un campo: partirla en varias
 * consumiría funciones serverless sin necesidad.
 *
 * El asistente PROPONE y nunca guarda. La propuesta vuelve al navegador y una
 * persona la edita y la acepta; recién ahí se crea la versión. Esta ruta no
 * tiene ninguna vía para escribir en `norma_articulo`, y la RPC que confirma
 * parámetros excluye explícitamente a `service_role`.
 *
 * Lo único que sí registra son los diagnósticos, que son hallazgos de máquina y
 * no habilitan nada por sí mismos: bloquean la exportación hasta que una
 * persona los atienda con fundamento.
 */
export async function POST(request: Request) {
  const limited = rateLimit(`fabrica:${clientIp(request)}`, IP_RATE_LIMIT.requests, IP_RATE_LIMIT.windowMs);
  if (!limited.ok) {
    return NextResponse.json({ error: "rate_limited" }, {
      status: 429,
      headers: { "Retry-After": String(limited.retryAfterSeconds), "Cache-Control": "no-store" },
    });
  }

  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const admin = createAdminClient({ timeoutMs: DB_TIMEOUT_MS });
  if (!admin) return response({ error: "not_configured" }, 503);

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return response({ error: "unauthorized" }, 401);

  let accion: Accion;
  let idea = "";
  let articuloId = "";
  let textoArticulo = "";
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.accion !== "proponer_articulo" && body.accion !== "diagnosticar_vigente") {
      return response({ error: "accion_invalida" }, 400);
    }
    accion = body.accion;
    idea = typeof body.idea === "string" ? body.idea.trim().slice(0, MAX_INPUT) : "";
    articuloId = typeof body.articuloId === "string" ? body.articuloId : "";
    textoArticulo = typeof body.texto === "string" ? body.texto.trim().slice(0, MAX_INPUT) : "";
  } catch {
    return response({ error: "bad_request" }, 400);
  }

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return response({ error: "unauthorized" }, 401);

  const { data: perfil, error: perfilError } = await admin
    .from("perfiles").select("rol").eq("user_id", user.id).maybeSingle();
  const rol = perfil?.rol as string | undefined;
  if (perfilError || !rol || !["administrador", "coordinador", "inspector"].includes(rol)) {
    return response({ error: "forbidden" }, 403);
  }

  const { data: cuota, error: cuotaError } = await admin
    .rpc("consumir_cuota_fabrica", { p_actor_id: user.id }).single();
  const cuotaRow = cuota as { permitido?: unknown; reintentar_en?: unknown } | null;
  if (cuotaError || typeof cuotaRow?.permitido !== "boolean") {
    console.error("fabrica cuota:", cuotaError?.message ?? "contrato inválido");
    return response({ error: "quota_unavailable" }, 503);
  }
  if (!cuotaRow.permitido) return response({ error: "rate_limited" }, 429);

  // Contexto: SIEMPRE de la normativa vigente. El proyecto en construcción no
  // se usa como fuente de sí mismo.
  const consulta = accion === "proponer_articulo" ? idea : textoArticulo;
  if (consulta.length < 20) return response({ error: "input_insuficiente" }, 400);

  /**
   * Dos búsquedas, y la diferencia es la que hace usable la herramienta.
   *
   * La función corta en 8 filas ANTES de mirar si el documento puede salir del
   * municipio, así que una sola búsqueda gastaba sus lugares en documentos que
   * el modelo no puede usar: medido con el Decreto 0609/18 habilitado, dos de
   * cada cinco consultas municipales típicas no recuperaban ni un fragmento
   * habilitado. Filtrar el resultado no lo arregla — para cuando llega, lo útil
   * ya quedó afuera del corte.
   *
   * `habilitada` es lo que ve el modelo. `general` es lo que se muestra en
   * pantalla, incluidos los documentos que no pueden salir: no se mandan
   * afuera, pero se leen acá.
   */
  const buscar = (soloIaExterna: boolean) => admin.rpc("buscar_rag_chunks_lexico", {
    p_query: consulta.slice(0, 500),
    p_match_count: MATCH_COUNT,
    p_estados: ["vigente"],
    p_solo_ia_externa: soloIaExterna,
  });
  const [general, habilitada] = await Promise.all([buscar(false), buscar(true)]);
  if (general.error || habilitada.error) {
    console.error("fabrica retrieval:", (general.error ?? habilitada.error)?.message);
    return response({ error: "retrieval_error" }, 502);
  }

  /**
   * `ocr_doubtful` NO está acá, y es a propósito (migración 28).
   *
   * Es una medida de la máquina: el ingest la enciende si alguna página quedó
   * bajo el umbral de confianza. Vetaba por su cuenta, y eso dejaba un callejón
   * sin salida — la Ordenanza 4728/2014 tiene una página con confianza 41, así
   * que por más que alguien leyera y corrigiera el texto entero, el documento
   * seguía bloqueado por una bandera que ya no describía nada.
   *
   * La revisión humana, que sí es obligatoria acá, es lo que contesta esa duda.
   * La duda no se borra: queda en `ocr_doubtful` y la pantalla la muestra al
   * lado del "Revisado". Las dos cosas conviven — la máquina dudó, una persona
   * chequeó — y sumar `or human_reviewed` sería escribir una tautología.
   */
  const puedeSalir = (fragmento: Fragmento) => (
    fragmento.audience === "publico"
    && fragmento.human_reviewed
    && fragmento.external_ai_allowed
  );
  // Cinturón y tirantes: la búsqueda restringida ya filtró, pero lo que sale
  // del municipio se comprueba también acá. Si las dos reglas se separaran,
  // esta es la que corta.
  const habilitados = (Array.isArray(habilitada.data) ? habilitada.data.filter(esFragmento) : [])
    .filter(puedeSalir);
  const generales = Array.isArray(general.data) ? general.data.filter(esFragmento) : [];

  // Saneado UNA sola vez: el mismo string que ve el modelo es contra el que se
  // verifican las citas. Si divergieran, toda cita válida se descartaría.
  const saneadosHabilitados = habilitados.map((fragmento) => sanearFragmento(fragmento.contenido));
  const contexto = habilitados
    .map((fragmento, indice) => `[${indice + 1}] ${fragmento.titulo}${fragmento.seccion ? ` · ${fragmento.seccion}` : ""}\n${saneadosHabilitados[indice]}`)
    .join("\n\n");

  /**
   * Para la pantalla: los dos conjuntos unidos, sin repetir, marcando cuáles
   * llegaron al modelo.
   *
   * El costo de filtrar en vez de bloquear es un falso negativo: el asistente
   * puede decir "sin hallazgos" porque no vio el documento donde estaba el
   * conflicto. Un "sin hallazgos" que no aclara qué se miró es peor que no
   * responder, así que la respuesta lo declara fragmento por fragmento.
   */
  const vistos = new Set(habilitados.map((fragmento) => fragmento.documento_id + "|" + fragmento.contenido));
  const detalleFragmentos = [...habilitados, ...generales]
    .filter((fragmento, indice, todos) => (
      todos.findIndex((otro) => (
        otro.documento_id === fragmento.documento_id && otro.contenido === fragmento.contenido
      )) === indice
    ))
    .map((fragmento) => ({
      titulo: fragmento.titulo,
      seccion: fragmento.seccion,
      contenido: sanearFragmento(fragmento.contenido),
      visto: vistos.has(fragmento.documento_id + "|" + fragmento.contenido),
    }));
  const sinVer = detalleFragmentos.filter((fragmento) => !fragmento.visto).length;

  const sinHabilitados = habilitados.length === 0;
  if (!EXTERNAL_AI_ENABLED || !openrouterKey || sinHabilitados || hasPotentialPii(consulta, contexto)) {
    return response({
      ok: true,
      asistido: false,
      motivo: !EXTERNAL_AI_ENABLED || !openrouterKey
        ? "asistencia_deshabilitada"
        : sinHabilitados
          ? "fuente_restringida"
          : "pii_detectada",
      fragmentos: detalleFragmentos,
      sinVer,
    });
  }

  if (accion === "proponer_articulo") {
    const propuesta = await llamarModelo(
      SISTEMA_REDACCION,
      `Normativa vigente relacionada:\n${contexto}\n\nIdea a convertir en artículo:\n${idea}`,
      openrouterKey,
    );
    if (!propuesta) return response({ error: "asistente_no_disponible" }, 502);

    if (propuesta.suficiente !== true) {
      return response({
        ok: true,
        asistido: true,
        suficiente: false,
        falta: typeof propuesta.falta === "string" ? propuesta.falta : "Faltan definiciones para escribir el artículo.",
        fragmentos: detalleFragmentos,
        sinVer,
      });
    }
    // La propuesta vuelve al navegador. No se guarda: la crea una persona al
    // aceptarla desde el editor.
    //
    // El encabezado se saca acá aunque el prompt ya lo prohíba: el modelo lo
    // escribe igual de vez en cuando, y un "ARTÍCULO X.-" dentro del cuerpo
    // sale duplicado en el documento final, porque la numeración la pone el
    // ensamblado según la posición.
    return response({
      ok: true,
      asistido: true,
      suficiente: true,
      sumilla: typeof propuesta.sumilla === "string" ? propuesta.sumilla : null,
      texto: typeof propuesta.texto === "string"
        ? quitarEncabezadoArticulo(propuesta.texto)
        : "",
      fragmentos: detalleFragmentos,
      sinVer,
    });
  }

  // diagnosticar_vigente
  const salida = await llamarModelo(
    SISTEMA_DIAGNOSTICO,
    `Normativa vigente:\n${contexto}\n\nArtículo en redacción:\n${textoArticulo}`,
    openrouterKey,
  );
  if (!salida) return response({ error: "asistente_no_disponible" }, 502);

  const crudosHallazgos = Array.isArray(salida.hallazgos) ? salida.hallazgos : [];
  // Contra los fragmentos que el modelo VIO, no contra todos: una cita que
  // coincidiera con un fragmento retenido sería una invención que da en el
  // blanco por casualidad, y pasaría por verificada.
  const { verificados, descartados } = verificarHallazgos(
    crudosHallazgos as HallazgoSinVerificar[],
    saneadosHabilitados,
  );
  if (descartados.length > 0) {
    // Queda en el log del servidor: un modelo que inventa citas es información
    // operativa, no algo para ocultar.
    console.warn(`fabrica: ${descartados.length} hallazgo(s) descartados por cita no verificable`);
  }

  if (verificados.length > 0 && articuloId) {
    const { error: registroError } = await admin.rpc("registrar_diagnosticos", {
      p_articulo_id: articuloId,
      p_diagnosticos: verificados.map((hallazgo) => ({
        tipo: hallazgo.tipo,
        severidad: hallazgo.severidad,
        descripcion: hallazgo.descripcion,
        referencia: hallazgo.referencia,
        cita: hallazgo.cita,
        datos: { confianza: hallazgo.confianza },
      })),
    });
    if (registroError) {
      console.error("fabrica registro:", registroError.message);
      return response({ error: "registro_fallido" }, 502);
    }
  }

  return response({
    ok: true,
    asistido: true,
    hallazgos: verificados,
    descartados: descartados.length,
    fragmentos: detalleFragmentos,
    sinVer,
  });
}
