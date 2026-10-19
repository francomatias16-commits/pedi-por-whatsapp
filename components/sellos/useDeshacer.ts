"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { filaParaRestaurar, type Deshacer } from "@/lib/fidelidad";

/** Guarda el último cambio de premios o campañas y permite volver atrás con un botón. */
export function useDeshacer(kioscoId: string, onCambio: () => void) {
  const [ultimo, setUltimo] = useState<Deshacer | null>(null);
  const [ocupado, setOcupado] = useState(false);

  /** Devuelve un texto de error, o null si se pudo volver atrás. */
  async function deshacer(): Promise<string | null> {
    if (!ultimo) return null;
    setOcupado(true);
    let error: { message: string } | null = null;
    if (ultimo.modo === "crear") {
      ({ error } = await supabase.from(ultimo.tabla).delete().eq("id", ultimo.id).eq("kiosco_id", kioscoId));
    } else if (ultimo.modo === "editar" && ultimo.fila) {
      ({ error } = await supabase.from(ultimo.tabla).update(filaParaRestaurar(ultimo.fila)).eq("id", ultimo.id).eq("kiosco_id", kioscoId));
    } else if (ultimo.modo === "borrar" && ultimo.fila) {
      ({ error } = await supabase.from(ultimo.tabla).insert({ ...ultimo.fila, kiosco_id: kioscoId }));
    }
    setOcupado(false);
    if (error) return "No se pudo deshacer. Revisá la lista y probá de nuevo.";
    setUltimo(null);
    onCambio();
    return null;
  }
  return { ultimo, ocupado, registrar: setUltimo, olvidar: () => setUltimo(null), deshacer };
}
