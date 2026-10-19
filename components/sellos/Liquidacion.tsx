"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { ACCIONES_LIQUIDAR, TIPO_LIQUIDACION_TEXTO, validarLiquidacion, type AccionLiquidar, type Liquidacion as Liq, type ProductoParado } from "@/lib/promos";
import { mensajeErrorSql } from "@/lib/errores";
import Aviso from "@/components/ui/Aviso";
import Insignia from "@/components/ui/Insignia";
import { useConfirmar } from "@/components/ui/Confirmar";

const pesos = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("es-AR")}`);

/** Productos con stock que hace días no se venden, y las promociones de liquidación activas. Todo el cálculo lo hace la base (0051). */
export default function Liquidacion({ kiosco, onCambio }: { kiosco: Kiosco; onCambio: () => void }) {
  const [dias, setDias] = useState(30);
  const [parados, setParados] = useState<ProductoParado[] | null>(null);
  const [activas, setActivas] = useState<Liq[]>([]);
  const [armando, setArmando] = useState<{ producto: ProductoParado; accion: AccionLiquidar } | null>(null);
  const [valor, setValor] = useState("");
  const [hasta, setHasta] = useState("");
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [ventana, confirmar] = useConfirmar();

  const cargar = useCallback(async () => {
    const [p, l] = await Promise.all([
      supabase.rpc("promo_sin_rotacion", { p_kiosco: kiosco.id, p_dias: dias }),
      supabase.rpc("promo_liquidaciones", { p_kiosco: kiosco.id }),
    ]);
    if (p.error) { setMsg(mensajeErrorSql(p.error.message, "club")); setOk(false); return; }
    setParados((p.data as ProductoParado[]) ?? []);
    if (!l.error) setActivas((l.data as Liq[]) ?? []);
  }, [kiosco.id, dias]);
  useEffect(() => { void cargar(); }, [cargar]);

  function elegir(producto: ProductoParado, accion: AccionLiquidar) { setArmando({ producto, accion }); setValor(accion.defecto); setHasta(""); setMsg(""); }

  async function activar() {
    if (!armando) return;
    const v = validarLiquidacion(armando.accion, valor);
    if (!v.ok) { setOk(false); return setMsg(v.error); }
    const { producto, accion } = armando;
    const frase = accion.clave === "descuento_sin_movimiento" ? `${v.valor}% de descuento en ${producto.nombre}${hasta ? ` hasta el ${hasta.split("-").reverse().join("/")}` : ""}`
      : accion.clave === "liquidar_sin_rotacion" ? `${producto.nombre} pasa a ser un premio de ${v.valor} sellos`
      : `Quien lleve 2 de ${producto.nombre} suma ${v.valor} sellos extra`;
    if (!(await confirmar({ titulo: accion.boton, detalle: `${frase}. ¿Lo activo?`, confirmar: "Sí, activar", cancelar: "No, volver" }))) return;
    setOcupado(true); setMsg("");
    let r = await supabase.rpc("promo_liquidar_activar", { p_kiosco: kiosco.id, p_clave: accion.clave, p_producto: producto.producto_id, p_valor: v.valor, p_hasta: hasta || null });
    // Si deja el producto por debajo del margen mínimo, se pide una segunda confirmación explícita.
    if (r.error?.message.includes("promo_reduce_margen")) {
      const sigue = await confirmar({ titulo: "Baja el margen", detalle: `Con esto ${producto.nombre} queda por debajo del margen mínimo de ${kiosco.club_margen_minimo ?? 20}%. ¿Querés activarla igual?`, confirmar: "Sí, activar igual", cancelar: "No, volver", peligro: true });
      if (!sigue) { setOcupado(false); return; }
      r = await supabase.rpc("promo_liquidar_activar", { p_kiosco: kiosco.id, p_clave: accion.clave, p_producto: producto.producto_id, p_valor: v.valor, p_hasta: hasta || null, p_confirmar_margen: true });
    }
    setOcupado(false);
    if (r.error) { setOk(false); return setMsg(mensajeErrorSql(r.error.message, "club")); }
    setArmando(null); setOk(true); setMsg("Listo, la promoción quedó activa. Podés deshacerla desde acá abajo.");
    await cargar(); onCambio();
  }

  async function pausar(id: string) {
    setOcupado(true); setMsg("");
    const { error } = await supabase.rpc("promo_liquidar_pausar", { p_kiosco: kiosco.id, p_id: id });
    setOcupado(false);
    if (error) { setOk(false); return setMsg(mensajeErrorSql(error.message, "club")); }
    setOk(true); setMsg("Listo, la promoción quedó pausada.");
    await cargar(); onCambio();
  }

  return (
    <div className="card">
      {ventana}
      <h3>Productos que no salen</h3>
      <p className="mut">Productos que no se vendieron en {dias} días: ofrecelos con descuento, como regalo o con sellos extra (una promo por producto).</p>
      <label>Sin ventas hace
        <select value={dias} onChange={(e) => setDias(Number(e.target.value))}>
          <option value={30}>30 días</option><option value={60}>60 días</option><option value={90}>90 días</option>
        </select>
      </label>
      {msg && <Aviso tipo={ok ? "ok" : "alerta"}>{msg}</Aviso>}

      {activas.length > 0 && (
        <section>
          <h4>Activas</h4>
          {activas.map((l) => (
            <div className="row fila-sep" key={l.id}>
              <span><b>{l.producto}</b><span className="mut"> · {TIPO_LIQUIDACION_TEXTO[l.tipo]} · {l.tipo === "descuento" ? `${l.valor}%` : `${l.valor} sellos`}</span></span>
              <button type="button" className="sec" disabled={ocupado} onClick={() => pausar(l.id)}>Pausar</button>
            </div>
          ))}
        </section>
      )}

      {!parados && <p className="mut">Buscando…</p>}
      {parados && parados.length === 0 && <p className="mut">No hay productos parados con ese criterio. Solo cuentan los que tienen el stock controlado.</p>}
      {parados?.map((p) => (
        <div className="fila-sep" key={p.producto_id}>
          <div className="row">
            <span><b>{p.nombre}</b><span className="mut"> · {p.stock} en stock · {p.dias_sin_venta} días sin venderse · parado: {pesos(p.capital)}</span></span>
            {p.liquidacion
              ? <Insignia tono="ok" icono="✔">{TIPO_LIQUIDACION_TEXTO[p.liquidacion as Liq["tipo"]] ?? "En promoción"}</Insignia>
              : <span className="row">{ACCIONES_LIQUIDAR.map((a) => <button type="button" className="sec" key={a.clave} disabled={ocupado} onClick={() => elegir(p, a)}>{a.boton}</button>)}</span>}
          </div>
          {armando?.producto.producto_id === p.producto_id && (
            <div>
              <label>{armando.accion.etiqueta}<input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></label>
              <label>Hasta (opcional)<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
              <div className="row">
                <button type="button" disabled={ocupado} onClick={activar}>Activar</button>
                <button type="button" className="sec" onClick={() => setArmando(null)}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
