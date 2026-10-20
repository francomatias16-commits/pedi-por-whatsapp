"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Kiosco } from "@/lib/supabase";
import { formatoNumero, nombreTipo } from "@/lib/arca/comun";
import { abrirPdf, comprobantesDeVenta, jsonArca, llamarArca, textoErrorArca, type EstadoVenta } from "@/lib/arca/cliente";
import { peso } from "@/lib/whatsapp";

// Factura C de una venta del mostrador y sus notas de crédito. No aparece si el local no activó la facturación (y la venta no tiene comprobantes).
export default function Facturacion({ kiosco, ventaId, anulada, recarga = 0, onCambio }: { kiosco: Kiosco; ventaId: string; anulada: boolean; recarga?: number; onCambio?: () => void }) {
  // Lazy: cada venta de la lista trae su <details> cerrado; solo se consulta la facturación cuando se abre.
  const [vista, setVista] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const d = ref.current?.closest("details");
    if (!d) { setVista(true); return; }
    const f = () => { if (d.open) setVista(true); };
    f(); d.addEventListener("toggle", f);
    return () => d.removeEventListener("toggle", f);
  }, []);
  const [e, setE] = useState<EstadoVenta | null>(null);
  const [dni, setDni] = useState("");
  const [conDni, setConDni] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const cargar = useCallback(async () => {
    try { setE(await comprobantesDeVenta(ventaId)); } catch (x) { setMsg({ tipo: "error", texto: (x as Error).message }); }
  }, [ventaId]);
  useEffect(() => { if (vista) cargar(); }, [vista, cargar, recarga]);

  async function emitir(ruta: string, cuerpo: Record<string, unknown>, exito: string) {
    setOcupado(true); setMsg(null);
    const { ok, r } = await llamarArca(ruta, kiosco.id, { venta: ventaId, ...cuerpo });
    const j = await jsonArca(r);
    setOcupado(false);
    if (!ok) setMsg({ tipo: "error", texto: textoErrorArca(j.error, j.detalle) });
    else if (j.estado === "emitido") setMsg({ tipo: "ok", texto: exito });
    else if (j.estado === "incierto") setMsg({ tipo: "error", texto: "ARCA no confirmó la respuesta. Tocá “Reintentar”: verificamos antes de emitir de nuevo, así no se duplica." });
    else setMsg({ tipo: "error", texto: `ARCA no aceptó el comprobante${j.error ? `: ${String(j.error)}` : ""}.` });
    await cargar(); onCambio?.();
  }

  if (!e) return <div ref={ref}>{msg && <p className="pos-error" role="alert">{msg.texto}</p>}</div>;
  const factura = e.comprobantes.find((c) => c.tipo === 11);
  const ncs = e.comprobantes.filter((c) => c.tipo === 13);
  if (!e.habilitada && !factura) return <div ref={ref} />;
  const vivas = ncs.reduce((s, c) => s + c.total, 0);
  const saldo = factura ? Math.round((factura.total - vivas) * 100) / 100 : 0;
  const sinNC = factura?.estado === "emitido" ? e.devoluciones.filter((d) => !ncs.some((c) => c.devolucion_id === d.id)) : [];
  const ver = async (id: string) => { const m = await abrirPdf(kiosco.id, id); if (m) setMsg({ tipo: "error", texto: m }); };

  const linea = (c: (typeof e.comprobantes)[number]) => (
    <div className="row" key={c.id}>
      <span>
        <b>{nombreTipo(c.tipo)}</b>{" "}
        {c.numero ? <span className="mono">{formatoNumero(c.punto_venta, c.numero)}</span> : null}{" "}
        <span className="mut">{c.homologacion ? "· de prueba " : ""}· {peso(c.total)}</span>
        {c.estado === "emitido" && <span className="chip-estado">Emitida</span>}
        {c.estado === "pendiente" && <span className="chip-estado">En proceso</span>}
        {c.estado === "incierto" && <span className="chip-estado">Sin confirmar</span>}
      </span>
      <span>
        {c.estado === "emitido" && <button className="sec" onClick={() => ver(c.id)}>Ver PDF</button>}
        {(c.estado === "pendiente" || c.estado === "incierto") && (
          <button className="sec" disabled={ocupado} onClick={() => emitir(c.tipo === 11 ? "/api/arca/facturar" : "/api/arca/nota-credito", c.tipo === 11 ? {} : { devolucion: c.devolucion_id }, "Comprobante emitido.")}>Reintentar</button>
        )}
      </span>
    </div>
  );

  return (
    <div className="recibo" aria-label="Facturación electrónica" ref={ref}>
      <p className="mut" style={{ margin: ".2rem 0" }}><b>Facturación electrónica</b></p>
      {e.comprobantes.map(linea)}
      {!factura && !anulada && e.habilitada && (
        <div>
          <label style={{ display: "block", margin: ".3rem 0" }}>
            <input type="checkbox" checked={conDni} onChange={(ev) => setConDni(ev.target.checked)} style={{ width: "auto", marginRight: 8 }} />El cliente pide la factura con su DNI
          </label>
          {conDni && <input value={dni} onChange={(ev) => setDni(ev.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="DNI del cliente" aria-label="DNI del cliente" maxLength={8} />}
          <button disabled={ocupado || (conDni && !/^\d{7,8}$/.test(dni))} onClick={() => emitir("/api/arca/facturar", conDni ? { doc_tipo: 96, doc_nro: dni } : {}, "Factura emitida.")}>
            {ocupado ? "Emitiendo…" : "Emitir Factura C"}
          </button>
          <p className="mut" style={{ margin: ".2rem 0" }}>Se factura el total de la venta{conDni ? " a nombre del DNI indicado" : " a Consumidor Final"}.</p>
        </div>
      )}
      {sinNC.map((d) => (
        <div className="row" key={d.id}>
          <span className="mut">Devolución #{d.numero} · {peso(d.total)}: sin nota de crédito</span>
          <button className="sec" disabled={ocupado} onClick={() => emitir("/api/arca/nota-credito", { devolucion: d.id }, "Nota de crédito emitida.")}>Emitir nota de crédito</button>
        </div>
      ))}
      {factura?.estado === "emitido" && !anulada && saldo > 0 && sinNC.length === 0 && (
        <div className="row">
          <span className="mut">Para anular la venta, primero la nota de crédito por el saldo ({peso(saldo)})</span>
          <button className="sec" disabled={ocupado} onClick={() => emitir("/api/arca/nota-credito", {}, "Nota de crédito emitida. Ahora podés anular la venta.")}>Emitir nota por el saldo</button>
        </div>
      )}
      {msg && <p className={msg.tipo === "error" ? "pos-error" : "pos-aviso"} role={msg.tipo === "error" ? "alert" : "status"}>{msg.texto}</p>}
    </div>
  );
}
