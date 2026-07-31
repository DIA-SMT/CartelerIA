/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Convierte los barrel imports de lucide-react en imports directos:
    // compila más rápido en dev y reduce el bundle del cliente.
    optimizePackageImports: ["lucide-react"],
  },
};
export default nextConfig;
