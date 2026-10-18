import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pedí por WhatsApp",
    short_name: "Pedí",
    description: "Catálogo, pedidos y fiado para tu kiosco",
    start_url: "/panel",
    scope: "/",
    display: "standalone",
    background_color: "#f6f3ec",
    theme_color: "#16302a",
    lang: "es-AR",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
