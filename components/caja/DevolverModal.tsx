"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { ETIQUETA_MEDIO, MEDIOS, cantidadTexto, mensajeError, necesitaPin, type Medio, type PosConfig } from "@/lib/caja";
import { armarItemsDevolucion, cantidadATexto, parsearCantidad, reembolsoItem, restante, totalReembolso, type SeleccionItem } from "@/lib/pos/devolucion";
import { cargarVentaCompleta, type VentaCompleta } from "@/lib/pos/venta-remota";
import { peso } from "@/lib/whatsapp";
import { usePin } from "./PinModal";

// Devolución parcial por renglón. Reembolsa lo que el cliente pagó de verdad (descuento prorrateado) y
// impacta en la caja ABIERTA, aunque la venta sea de un turno anterior.
export default function DevolverModal({ kiosco, ventaId, numero, config, onCerrar, onHecho }: {
  kiosco: Kiosco; ventaId: string; numero: number; config: PosConfig; onCerrar: () => void; onHecho: () => void;
}) {
  const [v, setV] = useState<VentaCompleta | null>(null);
  const [cargaErr, setCargaErr] = useState("");
  const [txt, setTxt] = useState<Record<string, string>>({});
  const [repone, setRepone] = useState<Record<string, boolean>>({});
  const [medio, setMedio] = useState<Medio>("efectivo");
  const [motivo, setMotivo] = useState("");
  const [err, setErr] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [hecha, setHecha] = useState<{ numero: number; total: number } | null>(null);
  const { pedir, modal } = usePin(kiosco.id);

  useEffect(() => {
    let vivo = true;
    cargarVentaCompleta(ventaId).then((r) => {
      if (!vivo) return;
      setV(r);
      const pagoCC = r.pagos.some((p) => p.medio === "cuenta_corriente");
      const principal = [...r.pagos].sort((a, b) => b.monto - a.monto)[0]?.medio;
      setMedio(principal && (principal !== "cuenta_corriente" || pagoCC) ? principal : "efectivo");
    }).catch((e: Error) => vivo && setCargaErr(e.message));
    return () => { vivo = false; };
  }, [ventaId]);

  const items = v?.itemsDevolver ?? [];
  const sel = useMemo(() => {
    const o: Record<string, SeleccionItem> = {};
    for (const i of items) o[i.id] = { cantidad: Math.min(parsearCantidad(txt[i.id] ?? "", i.por_peso), restante(i)), repone_stock: repone[i.id] ?? true };
    return o;
  }, [items, txt, repone]);
  const total = totalReembolso(items, sel);
  const hayCC = !!v?.pagos.some((p) => p.medio === "cuenta_corriente");
  const medios = MEDIOS.filter((m) => m !== "cuenta_corriente" || hayCC);
  const sinRestante = items.length > 0 && items.every((i) => restante(i) === 0);

  const devolverTodo = () => {
    setTxt(Object.fromEntries(items.filter((i) => restante(i) > 0).map((i) => [i.id, cantidadATexto(restante(i), i.por_peso)])));
  };

  async function confirmar() {
    if (!v || ocupado || total <= 0 || motivo.trim().length < 3) return;
    setErr("");
    const llamar = async (token: string | null) => {
      setOcupado(true);
      const r = await supabase.rpc("devolver_venta_mostrador", { p_venta: v.id, p_items: armarItemsDevolucion(items, sel), p_medio: medio, p_motivo: motivo.trim(), p_token: token });
      setOcupado(false);
      return r;
    };
    let token: string | null = null;
    if (necesitaPin(config, "devolucion")) {
      const t = await pedir(`Devolución sobre la venta #${v.numero}`);
      if (t === undefined) return;
      token = t;
    }
    let r = await llamar(token);
    // Si el servidor pide PIN y la pantalla no lo sabía (configuración desactualizada), se pide y se reintenta.
    if (r.error?.message.includes("pin_requerido") && token === null) {
      const t = await pedir(`Devolución sobre la venta #${v.numero}`);
      if (t === undefined) return;
      r = await llamar(t);
    }
    if (r.error) return setErr(r.error.message.includes("pin_requerido") ? "El PIN venció (dura 2 minutos). Probá de nuevo." : mensajeError(r.error.message));
    const d = r.data as { numero: number; total: number };
    setHecha({ numero: Number(d.numero), total: Number(d.total) });
    onHecho();
  }

  return (
    <div className="pos-overlay" role="dialog" aria-modal="true" aria-label={`Devolver venta ${numero}`}>
      <div className="pos-modal" style={{ maxWidth: 600 }}>
        <div className="pos-modal-head"><h2>Devolver · venta #{numero}</h2></div>
        {!v && !cargaErr && <p className="mut">Cargando venta…</p>}
        {cargaErr && <p className="pos-error" role="alert">{cargaErr}</p>}
        {hecha ? (
          <>
            <p className="pos-aviso" role="status">Devolución #{hecha.numero} registrada: {peso(hecha.total)} por {ETIQUETA_MEDIO[medio].toLowerCase()}.</p>
            <div className="pos-modal-acciones"><button onClick={onCerrar}>Listo</button></div>
          </>
        ) : v && (
          <>
            {v.anulada && <p className="pos-error" role="alert">Esta venta está anulada: no admite devoluciones.</p>}
            {sinRestante && <p className="mut">Esta venta ya fue devuelta por completo.</p>}
            {!v.anulada && !sinRestante && (
              <>
                <div className="pos-filtros" style={{ gridTemplateColumns: "1fr auto" }}>
                  <p className="mut" style={{ margin: 0 }}>{v.descuento > 0 ? "Se devuelve lo que el cliente pagó, con el descuento ya repartido." : "Indicá qué se devuelve."}</p>
                  <button className="sec" onClick={devolverTodo}>Devolver todo</button>
                </div>
                {items.map((i) => {
                  const rest = restante(i);
                  const q = sel[i.id].cantidad;
                  return (
                    <div className="card" key={i.id} style={{ margin: ".4rem 0", opacity: rest === 0 ? 0.55 : 1 }}>
                      <div className="row"><b>{i.nombre}</b><span className="mono">{peso(i.neto)}</span></div>
                      <p className="mut" style={{ margin: ".2rem 0" }}>
                        Vendido: {cantidadTexto(i.cantidad, i.por_peso)}{i.devuelto > 0 ? ` · ya devuelto: ${cantidadTexto(i.devuelto, i.por_peso)}` : ""}
                      </p>
                      {rest > 0 && (
                        <div className="row">
                          <label style={{ flex: 1 }}>{i.por_peso ? "Kg a devolver" : "Unidades a devolver"}
                            <input inputMode="decimal" value={txt[i.id] ?? ""} placeholder={`hasta ${cantidadATexto(rest, i.por_peso)}`} aria-label={`Cantidad a devolver de ${i.nombre}`}
                              onChange={(e) => setTxt({ ...txt, [i.id]: e.target.value })} />
                          </label>
                          <label style={{ display: "flex", gap: ".4rem", alignItems: "center" }}>
                            <input type="checkbox" checked={repone[i.id] ?? true} onChange={(e) => setRepone({ ...repone, [i.id]: e.target.checked })} /> Volver al stock
                          </label>
                        </div>
                      )}
                      {q > 0 && <p className="mut" style={{ margin: ".2rem 0" }}>Reembolso: <b className="mono">{peso(reembolsoItem(i, q))}</b></p>}
                      {rest > 0 && (txt[i.id] ?? "") !== "" && parsearCantidad(txt[i.id], i.por_peso) > rest && <p className="pos-error" role="alert">Máximo {cantidadATexto(rest, i.por_peso)}.</p>}
                    </div>
                  );
                })}
                <label>Devolver por
                  <select value={medio} onChange={(e) => setMedio(e.target.value as Medio)}>
                    {medios.map((m) => <option key={m} value={m}>{ETIQUETA_MEDIO[m]}</option>)}
                  </select>
                </label>
                <label>Motivo
                  <input value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: producto en mal estado, se equivocó de producto…" />
                </label>
                {err && <p className="pos-error" role="alert">{err}</p>}
                <div className="row" style={{ marginTop: ".6rem" }}><b>Total a devolver</b><b className="mono">{peso(total)}</b></div>
                <div className="pos-modal-acciones">
                  <button className="sec" onClick={onCerrar}>Cancelar</button>
                  <button className="peligro-solido" disabled={ocupado || total <= 0 || motivo.trim().length < 3} onClick={confirmar}>{ocupado ? "Registrando…" : "Registrar devolución"}</button>
                </div>
              </>
            )}
            {(v.anulada || sinRestante) && <div className="pos-modal-acciones"><button className="sec" onClick={onCerrar}>Cerrar</button></div>}
          </>
        )}
        {!v && cargaErr && <div className="pos-modal-acciones"><button className="sec" onClick={onCerrar}>Cerrar</button></div>}
      </div>
      {modal}
    </div>
  );
}
