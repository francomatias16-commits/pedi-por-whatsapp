import type { ReactNode } from "react";

// "¿Qué es esto?": explicación corta que se abre a un toque.
export default function Ayuda({ titulo = "¿Qué es esto?", children }: { titulo?: string; children: ReactNode }) {
  return (
    <details className="ayuda">
      <summary>{titulo}</summary>
      <div className="mut">{children}</div>
    </details>
  );
}
