"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { conPremioListo, mensajePremioListo } from "@/lib/club";
import { linkWhatsApp, normalizarTelefonoAR } from "@/lib/whatsapp";
import type { Premio } from "@/lib/fidelidad";

type Cli = { id: string; nombre: string; telefono: string; sellos_disponibles: number };

/** Clientes que ya completaron la tarjeta: se les avisa con un toque (abre el chat) y el premio se canjea desde Clientes. */
export default function PremiosListos({ kiosco, premio }: { kiosco: Kiosco; premio: Premio | null }) {
  const [lista, setLista] = useState<Cli[] | null>(null);
  const meta = premio?.costo_sellos ?? null;

  const cargar = useCallback(async () => {
    if (!meta) return setLista([]);
    const { data, error } = await supabase.from("clientes_sellos").select("id,nombre,telefono,sellos_disponibles")
      .eq("kiosco_id", kiosco.id).gte("sellos_disponibles", meta).order("sellos_disponibles", { ascending: false }).limit(50);
    if (!error) setLista(conPremioListo(((data ?? []) as Cli[]).map((c) => ({ ...c, sellos_disponibles: Number(c.sellos_disponibles) })), meta));
  }, [kiosco.id, meta]);
  useEffect(() => { void cargar(); }, [cargar]);

  if (!premio || !lista || lista.length === 0) return null;
  return (
    <div className="card">
      <h3>Tarjetas completas ({lista.length})</h3>
      <p className="mut" style={{ marginTop: 0 }}>Ya juntaron {premio.costo_sellos} sellos. Avisales con un toque; cuando vienen, canjeás el premio desde Clientes.</p>
      {lista.map((c) => (
        <div className="row fila-sep" key={c.id}>
          <span><b>{c.nombre}</b> · {c.sellos_disponibles} sellos</span>
          <a className="btn sec" target="_blank" rel="noreferrer" href={linkWhatsApp(normalizarTelefonoAR(c.telefono), mensajePremioListo(c.nombre, kiosco.nombre, premio.nombre))}>Avisarle por WhatsApp</a>
        </div>
      ))}
    </div>
  );
}
