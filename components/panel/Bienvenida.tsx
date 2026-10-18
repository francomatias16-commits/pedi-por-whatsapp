"use client";
import { useState } from "react";

// Recorrido de bienvenida de 4 pasos. Se muestra una vez y se puede repetir desde Mi negocio.
const PASOS = [
  { titulo: "Acá empieza tu día", texto: "En Inicio ves qué tenés que hacer. Lo urgente va primero." },
  { titulo: "Los pedidos llegan acá", texto: "Cuando un cliente pide desde tu tienda, aparece en Pedidos. Confirmalo y avisale por WhatsApp." },
  { titulo: "Cargá lo que vendés", texto: "En Productos cargás tus productos con su precio. Así la tienda muestra lo que tenés." },
  { titulo: "Compartí tu tienda", texto: "Mandá el link o el QR a tus clientes. Lo encontrás en Inicio y en Mi negocio." },
];

export default function Bienvenida({ onTerminar }: { onTerminar: () => void }) {
  const [i, setI] = useState(0);
  const ultimo = i === PASOS.length - 1;
  return (
    <div className="bienvenida" role="dialog" aria-modal="true" aria-labelledby="bien-t">
      <div className="bienvenida-card">
        <p className="mut">Paso {i + 1} de {PASOS.length}</p>
        <h2 id="bien-t">{PASOS[i].titulo}</h2>
        <p>{PASOS[i].texto}</p>
        <div className="progreso" aria-hidden="true"><span style={{ width: `${((i + 1) / PASOS.length) * 100}%` }} /></div>
        <div className="wiz-botones">
          <button type="button" className="sec" onClick={onTerminar}>Saltar</button>
          {i > 0 && <button type="button" className="sec" onClick={() => setI(i - 1)}>Volver</button>}
          {ultimo
            ? <button type="button" className="principal" onClick={onTerminar}>Listo, empezar</button>
            : <button type="button" className="principal" onClick={() => setI(i + 1)}>Seguir</button>}
        </div>
      </div>
    </div>
  );
}
