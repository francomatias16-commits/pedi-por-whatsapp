import type { ReactNode } from "react";

// Pantalla sin datos: explica qué es y qué hacer, en vez de dejar un hueco o un "No hay…".
export default function EstadoVacio({ titulo, children, accion }: { titulo: string; children?: ReactNode; accion?: ReactNode }) {
  return (
    <div className="vacio">
      <b>{titulo}</b>
      {children && <p className="mut">{children}</p>}
      {accion}
    </div>
  );
}
