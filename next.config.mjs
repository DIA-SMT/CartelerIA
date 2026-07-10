/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transformers.js (embeddings locales) usa onnxruntime-node: se resuelve en
  // runtime desde node_modules, no se bundlea en el server.
  experimental: {
    serverComponentsExternalPackages: ["@xenova/transformers"],
    // Convierte los barrel imports de lucide-react en imports directos:
    // compila más rápido en dev y reduce el bundle del cliente.
    optimizePackageImports: ["lucide-react"],
  },
};
export default nextConfig;
