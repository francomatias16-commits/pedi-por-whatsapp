"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { linkWhatsApp, normalizarTelefonoAR, peso } from "@/lib/whatsapp";
import { cantidadDesdeTexto, cantidadTexto, type LineaCompra } from "@/lib/compras";
import {
  ETIQUETA_ESTADO, agruparPorProveedor, cantidadAInput, costoEstimado, mensajePedidoProveedor, mensajeReposicion,
  normalizarFila, textoDias, type FilaReposicion, type ResumenRepo,
} from "@/lib/reposicion";
import { mensajePedido } from "@/lib/pedidos-proveedor";
import PedidosProveedor from "./PedidosProveedor";
import Pantalla from "@/components/ui/Pantalla";

// Cantidades editables por producto (texto tal como lo escribe la persona: kg si es por peso).
type Edits = Record<string, string>;

export default function Reponer({ kiosco, onComprar }: { kiosco: Kiosco; onComprar?: (proveedorId: string, lineas: LineaCompra[]) => void }) {
  const [filas, setFilas] = useState<FilaReposicion[] | null>(null);
  const [resumen, setResumen] = useState<ResumenRepo | null>(null);
  const [edits, setEdits] = useState<Edits>({});
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [clases, setClases] = useState<Record<string, string>>({});
  const [refrescoPedidos, setRefrescoPedidos] = useState(0);

  const cargar = useCallback(async () => {
    const [{ data: f, error: e1 }, { data: r, error: e2 }] = await Promise.all([
      supabase.rpc("reposicion_sugerida", { p_kiosco: kiosco.id }),
      supabase.rpc("reposicion_resumen", { p_kiosco: kiosco.id }),
    ]);
    if (e1 || e2) { setMsg(mensajeReposicion((e1 ?? e2)!.message)); return; }
    setFilas(((f ?? []) as Record<string, unknown>[]).map(normalizarFila));
    const rr = r as Record<string, unknown>;
    const { data: abc } = await supabase.rpc("curva_abc", { p_kiosco: kiosco.id, p_dias: 90 });
    setClases(Object.fromEntries(((abc ?? []) as { producto_id: string; clase: string }[]).map((x) => [x.producto_id, x.clase])));
    setResumen({ agotados: Number(rr.agotados), bajos: Number(rr.bajos), sin_proveedor: Number(rr.sin_proveedor), sin_datos: Number(rr.sin_datos), plata_en_stock: Number(rr.plata_en_stock) });
  }, [kiosco.id]);
  useEffect(() => { cargar(); }, [cargar]);

  const agrupado = useMemo(() => agruparPorProveedor(filas ?? []), [filas]);

  // Cantidad que va en el pedido: lo editado, o la sugerencia de la base.
  const cantidadDe = (f: FilaReposicion): number => {
    const txt = edits[f.producto_id];
    if (txt === undefined) return f.cantidad_sugerida;
    return cantidadDesdeTexto(txt, f.por_peso) ?? 0;
  };
  const textoDe = (f: FilaReposicion) => edits[f.producto_id] ?? cantidadAInput(f.cantidad_sugerida, f.por_peso);

  async function minimosIniciales() {
    setOcupado(true); setMsg("");
    const { data, error } = await supabase.rpc("reposicion_minimos_iniciales", { p_kiosco: kiosco.id });
    setOcupado(false);
    if (error) return setMsg(mensajeReposicion(error.message));
    const n = Number((data as { actualizados?: number })?.actualizados ?? 0);
    setMsg(n > 0 ? `Listo: le puse mínimo a ${n} producto${n > 1 ? "s" : ""} según lo que vendés.` : "No hay productos nuevos para poner mínimo.");
    await cargar();
  }

  // Guarda lo que se va a pedir como documento (borrador o ya enviado) para poder marcar después qué llegó.
  async function guardarPedido(proveedorId: string, lineas: { producto_id: string; cantidad: number }[], enviar: boolean) {
    setOcupado(true); setMsg("");
    const { error } = await supabase.rpc("pedido_proveedor_crear", {
      p_kiosco: kiosco.id, p_proveedor: proveedorId, p_enviar: enviar,
      p_items: lineas.filter((l) => l.cantidad > 0).map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad })),
    });
    setOcupado(false);
    if (error) return setMsg(mensajePedido(error.message));
    setMsg(enviar ? "Pedido guardado como enviado" : "Borrador guardado. Lo encontrás abajo, en Pedidos a proveedores.");
    setRefrescoPedidos((n) => n + 1);
  }

  const fila = (f: FilaReposicion) => (
    <div className="card" key={f.producto_id} style={{ margin: ".4rem 0" }}>
      <div className="row">
        <b>{f.nombre}</b>{clases[f.producto_id] && <span className="mut" style={{ marginLeft: 6, fontSize: 12 }}>Clase {clases[f.producto_id]}</span>}
        <span className={f.estado === "agotado" ? "" : "mut"} style={f.estado === "agotado" ? { color: "var(--danger)" } : undefined}>
          {ETIQUETA_ESTADO[f.estado]}
        </span>
      </div>
      <p className="mut" style={{ margin: ".2rem 0" }}>
        Hay {cantidadTexto(f.stock, f.por_peso)} · {textoDias(f)}
        {f.stock_minimo > 0 ? ` · mínimo ${cantidadTexto(f.stock_minimo, f.por_peso)}` : ""}
      </p>
      <label className="mut">Pedir ({f.por_peso ? "kg" : "unidades"})
        <input inputMode="decimal" value={textoDe(f)} onChange={(e) => setEdits({ ...edits, [f.producto_id]: e.target.value })} />
      </label>
    </div>
  );

  if (filas === null) return msg ? <p role="alert" style={{ color: "var(--danger)" }}>{msg}</p> : <p className="mut">Cargando…</p>;

  const hayAlgo = filas.length > 0;
  return (
    <Pantalla titulo="Qué comprar" ayuda="Acá ves lo que se agotó o se está por acabar, con cuánto pedir a cada proveedor. Tocá “Pedir por WhatsApp” y se arma el mensaje solo.">
      {resumen && (
        <div className="card row" style={{ flexWrap: "wrap", gap: 8 }}>
          <span>Agotados <b style={{ color: resumen.agotados ? "var(--danger)" : undefined }}>{resumen.agotados}</b></span>
          <span>Por acabarse <b>{resumen.bajos}</b></span>
          <span>Sin proveedor <b>{resumen.sin_proveedor}</b></span>
          <span className="mut">Mercadería en stock {peso(resumen.plata_en_stock)}</span>
        </div>
      )}
      {msg && <p role="status" className="mut">{msg}</p>}

      {!hayAlgo && (
        <div className="card">
          <p style={{ margin: 0 }}>Nada para reponer por ahora. ✔</p>
          <p className="mut" style={{ margin: ".4rem 0 0" }}>
            La app calcula esto con tu venta de los últimos 30 días y los mínimos que cargues en Productos.
          </p>
        </div>
      )}
      {(resumen?.sin_datos ?? 0) > 0 && (
        <div className="card">
          <b>Sin datos para calcular</b>
          <p className="mut" style={{ margin: ".2rem 0 .5rem" }}>
            Estos productos no tienen ventas ni mínimo, así que no sabemos cuánto pedir. Cargales un mínimo o un objetivo en Productos.
          </p>
          <button className="sec" disabled={ocupado} onClick={minimosIniciales}>Poner mínimos según mis ventas</button>
        </div>
      )}

      {agrupado.grupos.map((g) => {
        const lineas = g.filas.map((f) => ({ producto_id: f.producto_id, nombre: f.nombre, por_peso: f.por_peso, cantidad: cantidadDe(f) }));
        const { total, sinCosto } = costoEstimado(g.filas.map((f, i) => ({ cantidad: lineas[i].cantidad, por_peso: f.por_peso, costo: f.costo })));
        const tel = g.telefono ? normalizarTelefonoAR(g.telefono) : "";
        const pedidos = lineas.filter((l) => l.cantidad > 0);
        return (
          <section key={g.proveedor_id} style={{ marginTop: 16 }}>
            <div className="row">
              <h3 style={{ margin: 0 }}>{g.nombre}</h3>
              <span className="mut">{g.filas.length} producto{g.filas.length > 1 ? "s" : ""}</span>
            </div>
            {g.filas.map(fila)}
            <p className="mut" style={{ margin: ".4rem 0" }}>
              Costo estimado {peso(total)}{sinCosto > 0 ? ` · ${sinCosto} sin costo cargado` : ""}
            </p>
            {onComprar && g.filas.some((f) => cantidadDe(f) > 0) && (
              <button className="sec" style={{ marginRight: 8 }} onClick={() => onComprar(g.proveedor_id, g.filas
                .filter((f) => cantidadDe(f) > 0)
                .map((f) => ({ producto_id: f.producto_id, nombre: f.nombre, por_peso: f.por_peso, cantidad: cantidadDe(f), costo: f.costo ?? 0 })))}>
                Registrar compra con esto
              </button>
            )}
            {pedidos.length > 0 && <button className="sec" style={{ marginRight: 8 }} disabled={ocupado} onClick={() => guardarPedido(g.proveedor_id, pedidos, false)}>Guardar borrador</button>}
            {tel && pedidos.length > 0
              ? <a className="btn principal" href={linkWhatsApp(tel, mensajePedidoProveedor(kiosco.nombre, g.nombre, pedidos))} target="_blank" rel="noopener" onClick={() => void guardarPedido(g.proveedor_id, pedidos, true)}>Pedir por WhatsApp</a>
              : <p className="mut">{tel ? "No hay cantidades para pedir." : "Este proveedor no tiene teléfono cargado. Completalo en Proveedores."}</p>}
          </section>
        );
      })}

      {agrupado.sinProveedor.length > 0 && (
        <section style={{ marginTop: 16 }}>
          <h3>Sin proveedor asignado</h3>
          <p className="mut">Asignales un proveedor habitual en Productos para poder pedirlos desde acá.</p>
          {agrupado.sinProveedor.map((f) => (
            <div className="card row" key={f.producto_id} style={{ margin: ".4rem 0" }}>
              <span>{f.nombre} · {textoDias(f)}</span>
              <span className="mut">Pedir {cantidadTexto(f.cantidad_sugerida, f.por_peso)}</span>
            </div>
          ))}
        </section>
      )}
      <PedidosProveedor kiosco={kiosco} refresco={refrescoPedidos} onComprar={onComprar} />
    </Pantalla>
  );
}
