import { supabase } from "./supabase";

/**
 * Registra que esta sesión vio los datos fiscales de un cartel.
 *
 * A diferencia de la evidencia, acá el registro no puede ser bloqueante: el
 * dato ya viajó al navegador junto con el resto de la ficha, así que negar la
 * vista después no protegería nada y solo rompería la pantalla. Lo que sí
 * corresponde es avisar cuando la traza no se pudo escribir, para que nadie
 * asuma que la consulta quedó registrada.
 *
 * Devuelve false ante cualquier fallo; el llamador muestra el aviso.
 */
export async function registerFiscalDataAccess(cartelId: string): Promise<boolean> {
  if (!supabase || !cartelId) return false;
  const { error } = await supabase.rpc("registrar_acceso_sensible", {
    p_recurso: "cartel_datos_fiscales",
    p_recurso_id: cartelId,
  });
  if (error) console.warn("No se pudo registrar el acceso a datos fiscales.");
  return !error;
}
