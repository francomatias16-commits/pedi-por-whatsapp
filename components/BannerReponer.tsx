"use client";
import { useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";

// Aviso arriba del panel cuando hay agotados o productos por acabarse (no depende de tener el push activado).
export default function BannerReponer({ kiosco, onIr }: { kiosco: Kiosco; onIr: () => void }) {
  const [n, setN] = useState<{ agotados: number; bajos: number } | null>(null);
  useEffect(() => {
    supabase.rpc("reposicion_resumen", { p_kiosco: kiosco.id }).then(({ data }) => {
      const d = data as Record<string, number> | null;
      if (d) setN({ agotados: Number(d.agotados), bajos: Number(d.bajos) });
    });
  }, [kiosco.id]);
  if (!n || n.agotados + n.bajos === 0) return null;
  return (
    <div className="card row" role="status">
      <span>Hay <b style={{ color: n.agotados ? "#c0392b" : undefined }}>{n.agotados}</b> agotado{n.agotados === 1 ? "" : "s"} y <b>{n.bajos}</b> por acabarse</span>
      <button onClick={onIr}>Ver qué pedir</button>
    </div>
  );
}
