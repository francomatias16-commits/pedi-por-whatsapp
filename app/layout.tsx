import "./globals.css";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Barlow_Condensed, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

// Tres familias con rol fijo: Barlow Condensed (rotulado de cartel) para titulares y cifras grandes,
// Plex Sans para la interfaz, Plex Mono para precios y montos.
const display = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-display", display: "swap" });
const ui = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-ui", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Pedí por WhatsApp",
  description: "Catálogo y pedidos por WhatsApp para tu kiosco o almacén",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#14181d" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className={`${display.variable} ${ui.variable} ${mono.variable}`}>
      <body>
        <header className="franja">
          <Link href="/" className="franja-marca"><span className="franja-sello" aria-hidden="true" />Pedí por WhatsApp</Link>
        </header>
        <main>
          {children}
          <footer className="pie">
            <span>Pedí por WhatsApp</span>
            <Link href="/terminos">Términos</Link>
            <Link href="/privacidad">Privacidad</Link>
          </footer>
        </main>
      </body>
    </html>
  );
}
