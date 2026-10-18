"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { ProductoPos } from "@/lib/caja";
import { cantidadDesdeTexto, cantidadTexto } from "@/lib/compras";
import { mensajeReposicion } from "@/lib/reposicion";
import { PinModal } from "./PinModal";

// Carga de mercadería desde la caja (sumar_stock_rapido): suma al stock sin perder el carrito.
// Si el kiosco tiene PIN, lo pide antes; el servidor valida el token de un solo uso.
export default function CargaStockRapida({ kioscoId, producto, onCargado, onCancelar }: {
  kioscoId: string; producto: ProductoPos; onCargado: (cantidad: number) => void; onCancelar: () => void;
}) {
  const [txt, setTxt] = useState("");
  const [err, setErr] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [pinPara, setPinPara] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const cantidad = cantidadDesdeTexto(txt, producto.vendido_por_peso);

  async function cargar(cant: number, token: string | null) {
    setOcupado(true); setErr("");
    const { error } = await supabase.rpc("sumar_stock_rapido", { p_producto: producto.id, p_cantidad: cant, p_token: token });
    setOcupado(false);
    if (error) {
      if (error.message.includes("pin_requerido")) { setPinPara(cant); return; }
      setErr(mensajeReposicion(error.message)); return;
    }
    onCargado(cant);
  }

  return (
    <div className="pos-overlay" role="dialog" aria-modal="true" aria-label={`Cargar stock de ${producto.nombre}`} style={{ zIndex: 110 }}>
      <div className="pos-modal" style={{ maxWidth: 380 }}>
        <div className="pos-modal-head"><h2>Cargar stock</h2></div>
        <p className="mut">{producto.nombre}. Se suma al stock y vuelve al carrito, sin perder lo que ya armaste.</p>
        <label>{producto.vendido_por_peso ? "Kilos que llegaron" : "Unidades que llegaron"}
          <input ref={input} inputMode="decimal" value={txt} onChange={(e) => setTxt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); if (cantidad && !ocupado) void cargar(cantidad, null); }
              if (e.key === "Escape") { e.preventDefault(); onCancelar(); }
            }} />
        </label>
        {cantidad && <p className="mut" style={{ margin: ".3rem 0" }}>Se suman {cantidadTexto(cantidad, producto.vendido_por_peso)}</p>}
        {err && <p className="pos-error" role="alert">{err}</p>}
        <div className="pos-modal-acciones">
          <button className="sec" onClick={onCancelar}>Cancelar</button>
          <button disabled={!cantidad || ocupado} onClick={() => cantidad && cargar(cantidad, null)}>{ocupado ? "Cargando…" : "Cargar"}</button>
        </div>
      </div>
      {pinPara !== null && (
        <PinModal kioscoId={kioscoId} titulo="Para cargar mercadería hace falta el PIN de supervisor."
          onCancelar={() => setPinPara(null)}
          onToken={(t) => { const c = pinPara; setPinPara(null); if (c !== null) void cargar(c, t); }} />
      )}
    </div>
  );
}
