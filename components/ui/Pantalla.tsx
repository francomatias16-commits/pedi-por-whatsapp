import type { ReactNode } from "react";
import Ayuda from "./Ayuda";

// Marco de cada pantalla: título, ayuda opcional ("¿Qué es esto?") y acciones a la derecha.
export default function Pantalla({ titulo, ayuda, acciones, children }: { titulo: string; ayuda?: ReactNode; acciones?: ReactNode; children: ReactNode }) {
  return (
    <section className="pantalla">
      <div className="pantalla-cab">
        <h2>{titulo}</h2>
        {acciones && <div className="acciones">{acciones}</div>}
      </div>
      {ayuda && <Ayuda>{ayuda}</Ayuda>}
      {children}
    </section>
  );
}
