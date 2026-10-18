"use client";
import { useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { peso } from "@/lib/whatsapp";
import ProductosModificados from "@/components/ProductosModificados";
import Avisos from "@/components/Avisos";

type R = { pedidos: number; monto_pedidos: number; fiado_pendiente: number; deudores: number; sellos_semana: number; premios_semana: number; ultimo_ajuste: string | null; productos: number };

export default function Resumen({ kiosco, onIr }: { kiosco: Kiosco; onIr: (t: "precios" | "fiado" | "reponer" | "local") => void }) {
  const [r, setR] = useState<R | null>(null);
  const [err, setErr] = useState(false);
  const [copiado, setCopiado] = useState(false);
  async function copiarLink() {
    try { await navigator.clipboard.writeText(`${location.origin}/${kiosco.slug}`); setCopiado(true); setTimeout(() => setCopiado(false), 2500); } catch { setCopiado(false); }
  }
  const [stock, setStock] = useState<{ agotados: number; bajos: number; plata: number } | null>(null);
  const [vencido, setVencido] = useState<{ clientes: number; monto: number } | null>(null);
  useEffect(() => {
    supabase.rpc("resumen_semana", { p_kiosco: kiosco.id }).then(({ data, error }) => { if (error) setErr(true); else setR(data as R); });
  }, [kiosco.id]);
  useEffect(() => {
    supabase.rpc("fiado_vencido", { p_kiosco: kiosco.id, p_dias: 30 }).then(({ data }) => {
      const d = data as Record<string, number> | null;
      if (d) setVencido({ clientes: Number(d.clientes), monto: Number(d.monto) });
    });
  }, [kiosco.id]);
  useEffect(() => {
    supabase.rpc("reposicion_resumen", { p_kiosco: kiosco.id }).then(({ data }) => {
      const d = data as Record<string, number> | null;
      if (d) setStock({ agotados: Number(d.agotados), bajos: Number(d.bajos), plata: Number(d.plata_en_stock) });
    });
  }, [kiosco.id]);

  if (err) return <p role="alert" style={{ color: "var(--danger)" }}>No pudimos cargar el resumen.</p>;
  if (!r) return <p className="mut">Cargando…</p>;
  const dias = r.ultimo_ajuste ? Math.floor((Date.now() - new Date(r.ultimo_ajuste).getTime()) / 86400000) : null;
  const revisar = r.productos > 0 && (dias === null || dias >= 7);
  const Fila = ({ n, t }: { n: string | number; t: string }) => (<div className="card row"><span>{t}</span><b style={{ fontSize: 22 }}>{n}</b></div>);
  return (
    <>
      <Avisos kiosco={kiosco} soloPendiente />
      <div className="card row">
        <span>Tu tienda: <b>/{kiosco.slug}</b></span>
        <span className="acciones">
          <button type="button" onClick={copiarLink}>{copiado ? "Link copiado" : "Copiar link"}</button>
          <button type="button" className="sec" onClick={() => onIr("local")}>Ver QR</button>
        </span>
      </div>
      <h2>Últimos 7 días</h2>
      <Fila n={r.pedidos} t="Pedidos recibidos" />
      <Fila n={peso(Number(r.monto_pedidos))} t="Monto pedido" />
      <Fila n={peso(Number(r.fiado_pendiente))} t={`Fiado pendiente (${r.deudores} clientes)`} />
      <Fila n={r.sellos_semana} t="Puntos entregados" />
      <Fila n={r.premios_semana} t="Premios canjeados" />
      {vencido && vencido.clientes > 0 && (
        <div className="card">
          <b>Fiado para cobrar</b>
          <p className="mut">{vencido.clientes} cliente{vencido.clientes === 1 ? "" : "s"} debe{vencido.clientes === 1 ? "" : "n"} {peso(vencido.monto)} hace más de 30 días</p>
          <button onClick={() => onIr("fiado")}>Ver quién me debe</button>
        </div>
      )}
      {stock && stock.plata > 0 && (
        <div className="card">
          <b>Dinero parado en mercadería</b>
          <p className="mut">{peso(stock.plata)} entre stock y último costo</p>
          <button className="sec" onClick={() => onIr("reponer")}>Ver para reponer</button>
        </div>
      )}
      {stock && stock.agotados + stock.bajos > 0 && (
        <div className="card">
          <b>Hay mercadería para reponer</b>
          <p className="mut">{stock.agotados} agotado{stock.agotados === 1 ? "" : "s"} · {stock.bajos} por acabarse</p>
          <button onClick={() => onIr("reponer")}>Ver qué pedir</button>
        </div>
      )}
      {revisar && (
        <div className="card">
          <b>¿Revisaste tus precios?</b>
          <p className="mut">{dias === null ? "Todavía no ajustaste precios." : `Hace ${dias} días que no los ajustás.`} Con inflación se desactualizan rápido.</p>
          <button onClick={() => onIr("precios")}>Ajustar precios</button>
        </div>
      )}
      {r.deudores > 0 && <button className="sec" onClick={() => onIr("fiado")}>Ver quién me debe</button>}
      <ProductosModificados kiosco={kiosco} />
    </>
  );
}
