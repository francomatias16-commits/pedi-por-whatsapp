"use client";
import { supabase } from "@/lib/supabase";
import Aviso from "@/components/ui/Aviso";

// Cartel de la demo en vivo: se ve en todas las pantallas del panel mientras se está en el kiosco de ejemplo.
export default function AvisoDemo() {
  return (
    <Aviso tipo="info">
      <b>Estás en la demo.</b> Es un kiosco de ejemplo con datos ficticios: podés mirar todo, pero no se guarda nada. Se reinicia cada noche.{" "}
      <button type="button" className="sec" onClick={() => supabase.auth.signOut()}>Salir y crear mi kiosco</button>
    </Aviso>
  );
}
