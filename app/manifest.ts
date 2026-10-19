import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Go Fluxo",
    short_name: "Go Fluxo",
    description: "Catálogo, pedidos y fiado para tu kiosco",
    start_url: "/panel",
    scope: "/",
    display: "standalone",
    background_color: "#edefee",
    theme_color: "#14181d",
    lang: "es-AR",
    icons: [
      { src: "/icons/gofluxo-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/gofluxo-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/gofluxo-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
