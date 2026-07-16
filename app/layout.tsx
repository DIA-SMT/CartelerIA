import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";

export const metadata: Metadata = {
  title: "Cartelería Urbana SMT | Visualizador documental",
  description: "Consulta dinámica de documentos, relevamientos y normativa vinculada a la cartelería publicitaria de la ciudad.",
  icons: { icon: "/icon.png", apple: "/icon.png" }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body><AuthProvider>{children}</AuthProvider></body></html>;
}
