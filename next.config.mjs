/** @type {import('next').NextConfig} */
const nextConfig = {
  // Apagado por react-leaflet 4.2.1, que es incompatible con el doble montaje
  // de StrictMode: crea el mapa en un callback de ref con `deps: []`, así que
  // cuando React simula el desmontaje su limpieza todavía ve `context === null`
  // y no destruye nada. Al remontar, el mismo nodo ya tiene `_leaflet_id` y
  // tira "Map container is already initialized", que en dev tapa la pantalla
  // entera con el overlay de error.
  //
  // Solo afecta a desarrollo: React nunca duplica efectos en un build de
  // producción, así que el bundle servido no cambia. Se puede volver a activar
  // cuando el proyecto migre a react-leaflet 5 (requiere React 19).
  reactStrictMode: false,
  experimental: {
    // Convierte los barrel imports de lucide-react en imports directos:
    // compila más rápido en dev y reduce el bundle del cliente.
    optimizePackageImports: ["lucide-react"],
  },
};
export default nextConfig;
