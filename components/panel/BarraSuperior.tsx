"use client";
import type { Kiosco } from "@/lib/supabase";

// Barra fija de arriba: nombre del kiosco, interruptor de la tienda (abierta/cerrada), ayuda y salir.
export default function BarraSuperior({ kiosco, abierta, bloqueado, detalle, onInterruptor, onSalir, onAyuda }:
  { kiosco: Kiosco; abierta: boolean; bloqueado: boolean; detalle: string; onInterruptor: () => void; onSalir: () => void; onAyuda: () => void }) {
  return (
    <header className="barra-sup">
      <span className="barra-nombre">{kiosco.nombre}</span>
      <button type="button" role="switch" aria-checked={abierta} disabled={bloqueado} className={`interruptor${abierta ? " on" : ""}`} onClick={onInterruptor}>
        <span className="int-pista" aria-hidden="true"><span className="int-bola" /></span>
        <span className="int-texto"><b>{abierta ? "Tienda abierta" : "Tienda cerrada"}</b><small>{detalle}</small></span>
      </button>
      <span className="barra-acc">
        <button type="button" className="sec" onClick={onAyuda}>¿Cómo se usa?</button>
        <button type="button" className="sec" onClick={onSalir}>Salir</button>
      </span>
    </header>
  );
}
