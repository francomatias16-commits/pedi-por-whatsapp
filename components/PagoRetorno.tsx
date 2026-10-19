"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { linkWhatsApp, normalizarTelefonoAR, peso } from "@/lib/whatsapp";
import { CONSULTAS_MAX, vistaPago, type EstadoPublico } from "@/lib/pagos/retorno";

// Pantalla a la que vuelve el cliente desde Mercado Pago. Consulta el estado hasta que el pago se confirma.
export default function PagoRetorno({ slug, nombre, whatsapp, pedido }: { slug: string; nombre: string; whatsapp: string; pedido: string | null }) {
  const [d, setD] = useState<EstadoPublico | null>(null);
  const [error, setError] = useState("");
  const [consultas, setConsultas] = useState(0);
  const enCurso = useRef(false);

  const consultar = useCallback(async () => {
    if (!pedido || enCurso.current) return;
    enCurso.current = true;
    try {
      const r = await fetch(`/api/pagos/mp/estado?pedido=${encodeURIComponent(pedido)}`, { cache: "no-store" });
      if (r.status === 404 || r.status === 400) { setError("No encontramos este pedido."); return; }
      if (!r.ok) { setError("No pudimos consultar el pago. Probá de nuevo."); return; }
      setError(""); setD(await r.json());
    } catch { setError("No pudimos consultar el pago. Revisá tu conexión."); }
    finally { enCurso.current = false; setConsultas((n) => n + 1); }
  }, [pedido]);

  useEffect(() => { consultar(); }, [consultar]);
  const vista = d ? vistaPago(d) : null;
  useEffect(() => {
    if (vista !== "pendiente" || consultas >= CONSULTAS_MAX) return;
    const t = setTimeout(() => { if (document.visibilityState === "visible") consultar(); else setConsultas((n) => n + 1); }, 3000);
    return () => clearTimeout(t);
  }, [vista, consultas, consultar]);

  const avisar = d ? linkWhatsApp(normalizarTelefonoAR(whatsapp), `Hola! Hice el pedido #${d.numero} en ${nombre} y ya lo pagué con Mercado Pago.`) : "#";
  const consultarDeNuevo = () => { setConsultas(0); consultar(); };

  if (!pedido || (error && !d)) return (
    <>
      <h1>{nombre}</h1>
      <p role="alert" className="alerta">{error || "No encontramos este pedido."}</p>
      <p><Link className="btn" href={`/${slug}`}>Volver a la tienda</Link></p>
    </>
  );
  if (!d) return <><h1>{nombre}</h1><p role="status" className="mut">Consultando tu pago…</p></>;

  return (
    <>
      <h1>Pedido #{d.numero}</h1>
      {vista === "pagado" && (<>
        <p role="status"><b>Pago recibido.</b> {nombre} ya tiene tu pedido de {peso(Number(d.total))}.</p>
        <p className="mut">Si querés, avisale por WhatsApp para que lo prepare más rápido.</p>
        <a className="btn" href={avisar}>Avisar al local por WhatsApp</a>
      </>)}
      {vista === "cobrado_cancelado" && (<>
        <p role="alert" className="alerta"><b>Recibimos tu pago, pero el local no pudo tomar el pedido.</b> Te lo tienen que reembolsar.</p>
        <p className="mut">Escribile al local para coordinar el reembolso.</p>
        <a className="btn" href={avisar}>Escribir al local</a>
      </>)}
      {vista === "pendiente" && (<>
        <p role="status"><b>Estamos esperando la confirmación de Mercado Pago.</b></p>
        {consultas < CONSULTAS_MAX
          ? <p className="mut">Esta pantalla se actualiza sola. No la cierres hasta ver el pago confirmado.</p>
          : <p className="mut">Si ya pagaste, puede demorar unos minutos. Tocá el botón para volver a consultar.</p>}
        <button className="sec" onClick={consultarDeNuevo}>Consultar de nuevo</button>
        {d.link && <p><a href={d.link}>Volver a Mercado Pago</a></p>}
      </>)}
      {vista === "reintentar" && (<>
        <p role="alert" className="alerta"><b>El pago no se pudo completar.</b> Podés intentarlo de nuevo con otro medio de pago.</p>
        {d.link && <a className="btn" href={d.link}>Intentar de nuevo</a>}
      </>)}
      {vista === "fallido" && (<>
        <p role="alert" className="alerta"><b>El pedido no se pagó a tiempo y se canceló.</b> No se te cobró nada.</p>
        <p className="mut">Si pagaste y el dinero salió de tu cuenta, escribile al local.</p>
        <p><Link className="btn" href={`/${slug}`}>Hacer un pedido nuevo</Link></p>
      </>)}
      {vista === "reembolsado" && <p role="status"><b>Tu pago fue reembolsado.</b> Si tenés dudas, escribile a {nombre}.</p>}
      {vista === "no_online" && (<><p role="status">Este pedido no se paga online. {nombre} lo va a confirmar por WhatsApp.</p><p><Link className="btn" href={`/${slug}`}>Volver a la tienda</Link></p></>)}
      {error && <p role="alert" className="alerta">{error}</p>}
    </>
  );
}
