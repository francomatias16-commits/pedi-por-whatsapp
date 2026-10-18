import type { ReactNode } from "react";

type Tipo = "ok" | "error" | "alerta" | "info";
const ICONO: Record<Tipo, string> = { ok: "✔", error: "✖", alerta: "!", info: "i" };

// Mensaje con ícono + texto + color (nunca solo color). Los errores se anuncian al lector de pantalla.
export default function Aviso({ tipo = "info", children }: { tipo?: Tipo; children: ReactNode }) {
  return (
    <div className={`aviso aviso-${tipo}`} role={tipo === "error" ? "alert" : "status"}>
      <span className="aviso-ico" aria-hidden="true">{ICONO[tipo]}</span>
      <span>{children}</span>
    </div>
  );
}
