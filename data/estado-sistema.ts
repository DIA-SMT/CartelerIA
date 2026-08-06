/**
 * Estado del sistema que NO se puede consultar por API.
 *
 * Regla que ordena este archivo: nada de lo que hay acá se presenta como
 * comprobado. Son datos de configuración del panel de Supabase o del propio
 * repositorio, y viajan siempre con su origen y su fecha para que en una
 * presentación se pueda decir con precisión qué se verificó y cuándo.
 *
 * Lo que sí se puede consultar —privacidad y límites de los buckets, estado del
 * corpus— se lee en vivo desde `lib/configuracion-repository.ts` y no se
 * duplica acá.
 */

export type OrigenDato = "verificado_manualmente" | "declarado_en_repositorio";

export const ORIGEN_LABELS: Record<OrigenDato, string> = {
  verificado_manualmente: "Verificado a mano",
  declarado_en_repositorio: "Declarado en el repositorio",
};

export interface AjusteVerificado {
  concepto: string;
  valor: string;
  detalle: string;
  origen: OrigenDato;
  /** Fecha de la verificación, en ISO. */
  verificadoEn: string;
}

/**
 * Verificación de autenticación registrada en docs/decisiones-y-roadmap.md.
 * Si se vuelve a revisar el panel de Supabase, actualizar la fecha acá y allá.
 */
export const AJUSTES_AUTENTICACION: AjusteVerificado[] = [
  {
    concepto: "Registro público de cuentas",
    valor: "Cerrado",
    detalle: "Las cuentas las crea o invita un administrador; no hay alta pública.",
    origen: "verificado_manualmente",
    verificadoEn: "2026-07-29",
  },
  {
    concepto: "Confirmación de correo",
    valor: "Activa",
    detalle: "Una cuenta nueva debe confirmar su dirección antes de operar.",
    origen: "verificado_manualmente",
    verificadoEn: "2026-07-29",
  },
  {
    concepto: "Inicio de sesión anónimo",
    valor: "Desactivado",
    detalle: "No existe sesión sin identidad: sin cuenta no hay registro administrativo.",
    origen: "verificado_manualmente",
    verificadoEn: "2026-07-29",
  },
  {
    concepto: "Vinculación manual de identidades",
    valor: "Desactivada",
    detalle: "No se pueden fusionar cuentas de proveedores distintos.",
    origen: "verificado_manualmente",
    verificadoEn: "2026-07-29",
  },
];

export interface MigracionDeclarada {
  numero: number;
  archivo: string;
  resumen: string;
}

/**
 * Migraciones del repositorio. No hay CLI vinculado ni tabla de migraciones en
 * la base, así que la aplicación NO puede saber cuáles se aplicaron: esta lista
 * declara lo que el repositorio contiene, no lo que la instancia corrió.
 *
 * Un test de invariantes verifica que coincida con los archivos reales de
 * `supabase/migrations/`, para que no se desactualice en silencio.
 */
export const MIGRACIONES_DECLARADAS: MigracionDeclarada[] = [
  { numero: 1, archivo: "20260708_add_territorial_feature_link.sql", resumen: "Vínculo territorial en carteles" },
  { numero: 2, archivo: "20260708_02_add_inspecciones.sql", resumen: "Roles, perfiles e inspecciones" },
  { numero: 3, archivo: "20260708_03_perfil_on_signup.sql", resumen: "Perfil automático al crear cuenta" },
  { numero: 4, archivo: "20260708_04_storage_inspeccion_fotos.sql", resumen: "Bucket de fotografías" },
  { numero: 5, archivo: "20260708_05_rag_documentos.sql", resumen: "Corpus documental" },
  { numero: 6, archivo: "20260709_06_expedientes.sql", resumen: "Expedientes y su documentación" },
  { numero: 7, archivo: "20260709_07_rol_unico.sql", resumen: "Rol único por cuenta" },
  { numero: 8, archivo: "20260714_08_registro_cartel_ui.sql", resumen: "Alta de cartel desde la interfaz" },
  { numero: 9, archivo: "20260714_09_eliminar_inspecciones.sql", resumen: "Baja controlada de inspecciones" },
  { numero: 10, archivo: "20260716_10_endurecer_seguridad.sql", resumen: "Cuentas nuevas con rol mínimo" },
  { numero: 11, archivo: "20260729_11_privacidad_registro_administrativo.sql", resumen: "El registro exige sesión" },
  { numero: 12, archivo: "20260729_12_flujo_aprobaciones_auditoria.sql", resumen: "Aprobaciones y bitácora inmutable" },
  { numero: 13, archivo: "20260729_13_integridad_legal.sql", resumen: "Integridad legal de actuaciones y evidencia" },
  { numero: 14, archivo: "20260731_14_corregir_manifiesto_rag.sql", resumen: "Corrección del manifiesto del corpus" },
  { numero: 15, archivo: "20260731_15_busqueda_lexica_serverless.sql", resumen: "Búsqueda léxica sin modelo externo" },
  { numero: 16, archivo: "20260806_16_gobernanza_identidades.sql", resumen: "Roles auditados y privacidad consultiva" },
  { numero: 17, archivo: "20260806_17_indicadores_gestion.sql", resumen: "Indicadores de gestión" },
  { numero: 18, archivo: "20260806_18_corregir_alta_de_cuentas.sql", resumen: "El alta deja de crear administradores" },
  { numero: 19, archivo: "20260806_19_bitacora_y_corpus.sql", resumen: "Bitácora unificada y resumen del corpus" },
  { numero: 20, archivo: "20260806_20_corpus_estado_legal.sql", resumen: "Corpus separado por estado legal" },
  { numero: 21, archivo: "20260806_21_fabrica_normativa.sql", resumen: "Articulado de la ordenanza en construcción" },
  { numero: 22, archivo: "20260806_22_estado_legal_efectivo.sql", resumen: "El estado legal del corpus se aplica de verdad" },
  { numero: 23, archivo: "20260806_23_diagnostico_normativo.sql", resumen: "Parámetros confirmados y diagnósticos del articulado" },
  { numero: 24, archivo: "20260806_24_observaciones_articulo.sql", resumen: "Observaciones de las áreas por artículo" },
  { numero: 25, archivo: "20260806_25_articulo_nuevo_con_motivo.sql", resumen: "Un artículo nuevo nace diciendo qué se pidió" },
];
