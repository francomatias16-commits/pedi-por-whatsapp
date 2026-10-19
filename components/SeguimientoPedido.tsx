"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { DETALLE_ETAPA, SEGUIMIENTO_REFRESCO_MS, TITULO_ETAPA, TOKEN_RE, etapaFinal, pasoActual, pasosDe, type Seguimiento } from "@/lib/seguimiento";
import { linkWhatsApp, normalizarTelefonoAR } from "@/lib/whatsapp";

// Página pública del cliente. Se actualiza sola mientras el pedido no esté entregado ni cancelado.
export default function SeguimientoPedido({ token, inicial }: { token: string; inicial: Seguimiento | null }) {
  const [d, setD] = useState<Seguimiento | null>(inicial);
  const [falla, setFalla] = useState(false);

  useEffect(() => {
    if (!TOKEN_RE.test(token) || (d && etapaFinal(d.etapa))) return;
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const { data, error } = await supabase.rpc("seguimiento_pedido", { p_token: token });
      if (error) { setFalla(true); return; }
      setFalla(false); setD((data as Seguimiento | null) ?? null);
    }, SEGUIMIENTO_REFRESCO_MS);
    return () => clearInterval(t);
  }, [token, d]);

  if (!d) return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 16 }}>
      <h1>No encontramos este pedido</h1>
      <p role="alert" className="alerta">Revisá que el link esté completo o escribile al local que te lo mandó.</p>
    </main>
  );

  const pasos = pasosDe(d.modalidad), actual = pasoActual(d.etapa, d.modalidad);
  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 16 }}>
      <p className="mut">{d.local} · Pedido #{d.numero} · {d.modalidad === "envio" ? "Envío" : "Retiro en el local"}</p>
      <h1 role="status" aria-live="polite">{TITULO_ETAPA[d.etapa]}</h1>
      <p>{DETALLE_ETAPA[d.etapa]}</p>
      {actual >= 0 && (
        <ol aria-label="Etapas del pedido" style={{ listStyle: "none", padding: 0, margin: "16px 0" }}>
          {pasos.map((p, i) => (
            <li key={p.etapa} className="card" aria-current={i === actual ? "step" : undefined} style={{ opacity: i <= actual ? 1 : 0.55 }}>
              <b>{i < actual ? "✔ " : i === actual ? "● " : "○ "}{p.texto}</b>
            </li>
          ))}
        </ol>
      )}
      {falla && <p role="status" className="mut">No pudimos actualizar. Probamos de nuevo en unos segundos.</p>}
      <a className="btn sec" href={linkWhatsApp(normalizarTelefonoAR(d.whatsapp), `Hola! Consulto por mi pedido #${d.numero}.`)}>Escribir al local por WhatsApp</a>
    </main>
  );
}
