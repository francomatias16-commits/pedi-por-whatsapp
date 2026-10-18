import type { ReactNode } from "react";

type Tono = "ok" | "alerta" | "error" | "info" | "neutro";

// Etiqueta de estado con ícono + palabra + color.
export default function Insignia({ tono = "neutro", icono, children }: { tono?: Tono; icono?: string; children: ReactNode }) {
  return <span className={`insignia insignia-${tono}`}>{icono && <span aria-hidden="true">{icono}</span>}{children}</span>;
}
