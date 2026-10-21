"use client";
import type { Kiosco } from "@/lib/supabase";
import type { Campana } from "@/lib/fidelidad";
import HorasFlojas from "./HorasFlojas";
import Rentabilidad from "./Rentabilidad";

// Todo lo opcional para atraer, recuperar o premiar clientes. El programa básico funciona sin tocar nada de acá.
export default function Promociones({ kiosco, campanas, onCambio }: { kiosco: Kiosco; campanas: Campana[]; onCambio: () => void }) {
  return (
    <>
      <p className="mut">Opcional. Ofertas para traer clientes nuevos, recuperar a los que dejaron de venir o mover mercadería. Te avisamos si una promo te deja sin margen.</p>
      <Rentabilidad kiosco={kiosco} onCambio={onCambio} />
      <HorasFlojas kiosco={kiosco} campanas={campanas} onCambio={onCambio} />
    </>
  );
}
