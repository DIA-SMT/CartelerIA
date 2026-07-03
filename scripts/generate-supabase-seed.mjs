import fs from "node:fs/promises";

const carteles = JSON.parse(await fs.readFile(new URL("../data/carteles.json", import.meta.url), "utf8"));
const quote = value => value == null ? "null" : `'${String(value).replaceAll("'", "''")}'`;
const number = value => value == null ? "null" : String(value);
const status = (index, located) => !located ? "sin_datos" : ["relevado","habilitado","pendiente","observado","infraccion","relevado"][index % 6];
const contamination = index => ["bajo","medio","medio","alto","alto","critico"][index % 6];
const zone = address => {
  const value = String(address).toUpperCase();
  if (value.includes("MATE DE LUNA")) return "Av. Mate de Luna";
  if (value.includes("BELGRANO")) return "Av. Belgrano";
  if (value.includes("ALEM")) return "Av. Alem";
  if (value.includes("ROCA")) return "Av. Roca";
  if (["SAN MARTIN","24 DE SEPTIEMBRE","CONGRESO","LAPRIDA","MAIPU"].some(street => value.includes(street))) return "Microcentro";
  return "Otros sectores";
};

const rows = carteles.map((item, index) => {
  const located = item.latitud != null && item.longitud != null;
  return `(${[
    quote(item.id), quote(item.empresa), quote(item.cuit), quote(item.tipoCartel), quote(item.dimensiones), number(item.superficieM2),
    quote(item.domicilio), quote(item.numero), quote(item.googleMapsUrl), quote(item.padronCisi), quote(item.estado), number(item.latitud),
    number(item.longitud), quote(item.locationSource), quote(status(index, located)), quote(contamination(index)), quote(zone(item.domicilio)),
    "null", number(item.latitud), number(item.longitud), "false"
  ].join(",")})`;
});

const header = "insert into public.carteles (id,empresa,cuit,tipo_cartel,dimensiones,superficie_m2,domicilio,numero,google_maps_url,padron_cisi,estado,latitud,longitud,location_source,status,contamination_level,zone,street_view_image_url,original_latitud,original_longitud,location_edited) values";
const conflict = "on conflict (id) do update set empresa=excluded.empresa,cuit=excluded.cuit,tipo_cartel=excluded.tipo_cartel,dimensiones=excluded.dimensiones,superficie_m2=excluded.superficie_m2,domicilio=excluded.domicilio,numero=excluded.numero,google_maps_url=excluded.google_maps_url,padron_cisi=excluded.padron_cisi,estado=excluded.estado,latitud=excluded.latitud,longitud=excluded.longitud,location_source=excluded.location_source,status=excluded.status,contamination_level=excluded.contamination_level,zone=excluded.zone,original_latitud=excluded.original_latitud,original_longitud=excluded.original_longitud,updated_at=now();";
const sql = `${header}\n${rows.join(",\n")}\n${conflict}\n`;
await fs.writeFile(new URL("../supabase/seed.sql", import.meta.url), sql, "utf8");

const batchSize = 83;
for (let start = 0; start < rows.length; start += batchSize) {
  const batch = rows.slice(start, start + batchSize);
  const part = Math.floor(start / batchSize) + 1;
  await fs.writeFile(new URL(`../supabase/seed_part_${part}.sql`, import.meta.url), `${header}\n${batch.join(",\n")}\n${conflict}\n`, "utf8");
}
console.log(`Seed generado con ${carteles.length} carteles en ${Math.ceil(rows.length / batchSize)} partes.`);
