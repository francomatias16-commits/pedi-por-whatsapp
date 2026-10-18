"use client";
import { useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { peso } from "@/lib/whatsapp";
import { describirPremio, type Premio } from "@/lib/fidelidad";
import type { Cliente } from "@/lib/caja";

/** Sellos del cliente elegido y premios que puede canjear en esta venta. El canje se registra al cobrar (en PosVenta). */
export default function FidelidadCaja({ kiosco, cliente, aplicado, pct, descuento, online, onAplicar, onQuitar }: {
  kiosco: Kiosco; cliente: Cliente; aplicado: Premio | null; pct: number; descuento: number; online: boolean;
  onAplicar: (p: Premio) => void; onQuitar: () => void;
}) {
  const [saldo, setSaldo] = useState<number | null>(null);
  const [premios, setPremios] = useState<Premio[]>([]);
  useEffect(() => {
    let vivo = true;
    setSaldo(null);
    (async () => {
      const [s, p] = await Promise.all([
        supabase.from("clientes_sellos").select("sellos_disponibles").eq("id", cliente.id).maybeSingle(),
        supabase.from("fidelidad_premios").select("id,nombre,descripcion,costo_sellos,tipo,producto_id,valor,activo").eq("kiosco_id", kiosco.id).eq("activo", true).order("costo_sellos"),
      ]);
      if (!vivo) return;
      setSaldo(s.data ? Number(s.data.sellos_disponibles) : 0);
      setPremios(((p.data ?? []) as Premio[]).map((x) => ({ ...x, valor: x.valor == null ? null : Number(x.valor) })));
    })();
    return () => { vivo = false; };
  }, [cliente.id, kiosco.id]);

  if (saldo === null) return null;
  const disponibles = premios.filter((p) => saldo >= p.costo_sellos);
  const proximo = premios.find((p) => saldo < p.costo_sellos);
  return (
    <div className="pos-fidelidad">
      <p className="mut pos-saldo" style={{ margin: ".3rem 0 0" }}>Sellos: <b>{saldo}</b>{!aplicado && proximo ? ` · faltan ${proximo.costo_sellos - saldo} para “${proximo.nombre}”` : ""}</p>
      {aplicado ? (
        <div className="row" style={{ marginTop: 6 }}>
          <span><b>{aplicado.nombre}</b> <span className="mut">({aplicado.costo_sellos} sellos){aplicado.tipo === "libre" ? " · entregalo al cliente" : descuento > 0 ? ` · −${peso(descuento)} (${pct}%)` : ""}</span></span>
          <button type="button" className="sec" onClick={onQuitar}>Quitar</button>
        </div>
      ) : disponibles.length > 0 && (
        <div className="row" style={{ justifyContent: "flex-start", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {disponibles.map((p) => (
            <button type="button" key={p.id} className="sec" disabled={!online} title={describirPremio(p)} onClick={() => onAplicar(p)}>Canjear: {p.nombre}</button>
          ))}
          {!online && <span className="mut">Sin conexión: los canjes se hacen con internet.</span>}
        </div>
      )}
      {aplicado && aplicado.tipo !== "libre" && <p className="mut" style={{ margin: ".2rem 0 0" }}>El descuento del premio reemplaza al descuento manual y se confirma al cobrar.</p>}
    </div>
  );
}
