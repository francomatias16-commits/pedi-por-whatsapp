"use client";
import { useConfirmar } from "@/components/ui/Confirmar";
import { useCallback, useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { linkWhatsApp, normalizarTelefonoAR } from "@/lib/whatsapp";
import { cantidadAInput, mensajePedidoProveedor } from "@/lib/reposicion";
import { cantidadTexto, type LineaCompra } from "@/lib/compras";
import {
  ETIQUETA_PEDIDO, acciones, armarRecepcion, lineasParaCompra, mensajePedido, pendiente, textoFaltante, type PedidoProv,
} from "@/lib/pedidos-proveedor";

type Prov = { id: string; nombre: string; telefono: string | null };

// Pedidos a proveedor con estados: borrador → enviado → llegó una parte → recibido (o cancelado).
// No mueve stock ni deuda: cuando llega la mercadería se registra la compra (acá se precarga con lo que llegó).
export default function PedidosProveedor({ kiosco, refresco, onComprar }: { kiosco: Kiosco; refresco: number; onComprar?: (proveedorId: string, lineas: LineaCompra[]) => void }) {
  const [ventanaConfirmar, confirmar] = useConfirmar();
  const [pedidos, setPedidos] = useState<PedidoProv[] | null>(null);
  const [provs, setProvs] = useState<Record<string, Prov>>({});
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [recibiendo, setRecibiendo] = useState<string | null>(null);
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [llego, setLlego] = useState<{ proveedorId: string; lineas: LineaCompra[] } | null>(null);

  const cargar = useCallback(async () => {
    const [{ data: ps, error: e1 }, { data: pv }] = await Promise.all([
      supabase.from("pedidos_proveedor").select("id,numero,estado,proveedor_id,created_at,pedido_proveedor_items(id,producto_id,nombre,por_peso,cantidad,recibida)")
        .eq("kiosco_id", kiosco.id).order("created_at", { ascending: false }).limit(40),
      supabase.from("proveedores").select("id,nombre,telefono").eq("kiosco_id", kiosco.id),
    ]);
    if (e1) { setMsg(mensajePedido(e1.message)); return; }
    setProvs(Object.fromEntries(((pv ?? []) as Prov[]).map((p) => [p.id, p])));
    setPedidos(((ps ?? []) as unknown as (Omit<PedidoProv, "items"> & { pedido_proveedor_items: PedidoProv["items"] })[]).map(({ pedido_proveedor_items, ...p }) => ({
      ...p, numero: Number(p.numero), items: [...pedido_proveedor_items].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    })));
  }, [kiosco.id]);
  useEffect(() => { void cargar(); }, [cargar, refresco]);

  async function accion(rpc: string, id: string, ok: string) {
    setOcupado(true); setMsg("");
    const { error } = await supabase.rpc(rpc, { p_pedido: id });
    setOcupado(false);
    if (error) setMsg(mensajePedido(error.message)); else setMsg(ok);
    await cargar();
  }

  async function confirmarRecepcion(p: PedidoProv) {
    const r = armarRecepcion(p.items, textos);
    if (!r.ok) return setMsg(r.error);
    setOcupado(true); setMsg("");
    const { error } = await supabase.rpc("pedido_proveedor_recibir", { p_pedido: p.id, p_items: r.payload });
    if (error) { setOcupado(false); setMsg(mensajePedido(error.message)); await cargar(); return; }
    const ids = r.payload.map((x) => p.items.find((i) => i.id === x.item_id)?.producto_id).filter((x): x is string => !!x);
    const { data: cs } = ids.length ? await supabase.from("productos").select("id,costo").in("id", ids) : { data: [] };
    const costos = Object.fromEntries(((cs ?? []) as { id: string; costo: number | null }[]).map((c) => [c.id, c.costo === null ? null : Number(c.costo)]));
    setOcupado(false);
    setLlego({ proveedorId: p.proveedor_id, lineas: lineasParaCompra(p.items, r.payload, costos) });
    setRecibiendo(null); setTextos({});
    setMsg("Recepción registrada. Falta cargar la compra para que entre el stock.");
    await cargar();
  }

  if (pedidos === null) return msg ? <p role="alert" style={{ color: "var(--danger)" }}>{msg}</p> : null;
  if (pedidos.length === 0) return null;
  const activos = pedidos.filter((p) => p.estado === "borrador" || p.estado === "enviada" || p.estado === "recibida_parcial");
  const anteriores = pedidos.filter((p) => !activos.includes(p));

  const tarjeta = (p: PedidoProv) => {
    const a = acciones(p.estado);
    const prov = provs[p.proveedor_id];
    const tel = prov?.telefono ? normalizarTelefonoAR(prov.telefono) : "";
    const falta = textoFaltante(p.items);
    return (
      <div className="card" key={p.id} style={{ margin: ".4rem 0" }}>
      {ventanaConfirmar}
        <div className="row">
          <b>#{p.numero} · {prov?.nombre ?? "Proveedor"}</b>
          <span className="mut">{ETIQUETA_PEDIDO[p.estado]} · {new Date(p.created_at).toLocaleDateString("es-AR")}</span>
        </div>
        {p.items.map((i) => (
          <div className="row" key={i.id} style={{ fontSize: 14 }}>
            <span>{i.nombre}</span>
            <span className="mut">{p.estado === "borrador" || p.estado === "cancelada" ? cantidadTexto(i.cantidad, i.por_peso) : `${cantidadTexto(i.recibida, i.por_peso)} de ${cantidadTexto(i.cantidad, i.por_peso)}`}</span>
          </div>
        ))}
        {p.estado === "recibida_parcial" && falta && <p className="mut" style={{ margin: ".3rem 0" }}>Falta: {falta}</p>}

        {recibiendo === p.id && (
          <div style={{ marginTop: 8 }}>
            <p className="mut" style={{ margin: ".2rem 0" }}>Escribí lo que llegó ahora (por peso, en kilos). Dejá en blanco lo que no llegó.</p>
            {p.items.filter((i) => pendiente(i) > 0).map((i) => (
              <label className="mut" key={i.id} style={{ display: "block" }}>{i.nombre} (faltan {cantidadTexto(pendiente(i), i.por_peso)})
                <input inputMode="decimal" value={textos[i.id] ?? ""} onChange={(e) => setTextos({ ...textos, [i.id]: e.target.value })} />
              </label>
            ))}
            <div className="row" style={{ justifyContent: "flex-start", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              <button className="sec" disabled={ocupado} onClick={() => setTextos(Object.fromEntries(p.items.filter((i) => pendiente(i) > 0).map((i) => [i.id, cantidadAInput(pendiente(i), i.por_peso)])))}>Llegó todo</button>
              <button disabled={ocupado} onClick={() => confirmarRecepcion(p)}>Confirmar recepción</button>
              <button className="sec" disabled={ocupado} onClick={() => { setRecibiendo(null); setTextos({}); }}>Cancelar</button>
            </div>
          </div>
        )}

        <div className="row" style={{ justifyContent: "flex-start", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {a.enviar && tel && (
            <a className="btn" href={linkWhatsApp(tel, mensajePedidoProveedor(kiosco.nombre, prov?.nombre ?? "", p.items.map((i) => ({ nombre: i.nombre, por_peso: i.por_peso, cantidad: i.cantidad }))))}
              target="_blank" rel="noopener" onClick={() => void accion("pedido_proveedor_enviar", p.id, "Pedido marcado como enviado")}>Enviar por WhatsApp</a>
          )}
          {a.enviar && <button className="sec" disabled={ocupado} onClick={() => accion("pedido_proveedor_enviar", p.id, "Pedido marcado como enviado")}>Marcar como enviado</button>}
          {a.recibir && recibiendo !== p.id && <button disabled={ocupado} onClick={() => { setRecibiendo(p.id); setTextos({}); setMsg(""); }}>Registrar lo que llegó</button>}
          {a.cerrar && <button className="sec" disabled={ocupado} onClick={async () => { if (await confirmar({ titulo: "¿Dar por cerrado el pedido? Lo que no llegó ya no se espera.", confirmar: "Sí, seguir", peligro: true })) void accion("pedido_proveedor_cerrar", p.id, "Pedido cerrado"); }}>Cerrar sin lo que falta</button>}
          {a.cancelar && <button className="sec" disabled={ocupado} onClick={async () => { if (await confirmar({ titulo: "¿Cancelar este pedido?", confirmar: "Sí, seguir", peligro: true })) void accion("pedido_proveedor_cancelar", p.id, "Pedido cancelado"); }}>Cancelar pedido</button>}
        </div>
      </div>
    );
  };

  return (
    <section style={{ marginTop: 24 }}>
      <h3>Pedidos a proveedores</h3>
      {msg && <p role="status" className="mut">{msg}</p>}
      {llego && onComprar && llego.lineas.length > 0 && (
        <div className="card">
          <p style={{ margin: "0 0 .5rem" }}>Cuando tengas la factura, cargá la compra con lo que llegó.</p>
          <button onClick={() => { onComprar(llego.proveedorId, llego.lineas); setLlego(null); }}>Registrar compra con lo que llegó</button>
        </div>
      )}
      {activos.length === 0 && <p className="mut">No hay pedidos abiertos.</p>}
      {activos.map(tarjeta)}
      {anteriores.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="mut">Anteriores ({anteriores.length})</summary>
          {anteriores.map(tarjeta)}
        </details>
      )}
    </section>
  );
}
