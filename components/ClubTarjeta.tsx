"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { CLUB_TOKEN_RE, casilleros, claveTokenLocal, faltan, textoBloqueo, type Tarjeta } from "@/lib/club";
import { mensajeErrorSql } from "@/lib/errores";
import InstalarApp from "@/components/panel/InstalarApp";

const dia = (s: string) => new Date(s).toLocaleDateString("es-AR", { day: "numeric", month: "short" });

// Tarjeta del cliente: sus sellos y el botón "Sumar mi compra". Se instala en el celular como app (manifest propio).
export default function ClubTarjeta({ token, inicial }: { token: string; inicial: Tarjeta | null }) {
  const [t, setT] = useState<Tarjeta | null>(inicial);
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const enCurso = useRef(false);

  const recargar = useCallback(async () => {
    if (!CLUB_TOKEN_RE.test(token)) return;
    const { data, error } = await supabase.rpc("club_tarjeta", { p_token: token });
    if (!error) setT((data as Tarjeta | null) ?? null);
  }, [token]);

  // Guarda la llave en el celular (para que el QR del local lleve directo acá) y refresca al volver a la app.
  useEffect(() => {
    if (t?.slug) { try { localStorage.setItem(claveTokenLocal(t.slug), token); } catch { /* sin almacenamiento */ } }
  }, [t?.slug, token]);
  useEffect(() => {
    const vis = () => { if (document.visibilityState === "visible") void recargar(); };
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, [recargar]);
  // Si estaba en espera, se habilita sola cuando se cumple.
  const espera = t?.bloqueo?.codigo === "club_espera" ? t.bloqueo.espera_seg ?? 0 : 0;
  useEffect(() => {
    if (!espera) return;
    const id = setTimeout(() => void recargar(), (espera + 1) * 1000);
    return () => clearTimeout(id);
  }, [espera, recargar]);

  async function sumar() {
    if (enCurso.current) return; // dos toques seguidos no mandan dos pedidos
    enCurso.current = true; setOcupado(true); setMsg("");
    try {
      const r = await fetch("/api/club/sumar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
      const j = await r.json();
      if (!r.ok) { setMsg(mensajeErrorSql(j.error, "club")); await recargar(); return; }
      setT(j as Tarjeta);
      setMsg(`¡Listo! Llevás ${(j as Tarjeta).sellos}${(j as Tarjeta).meta ? ` de ${(j as Tarjeta).meta}` : ""}.`);
    } catch {
      setMsg("No pudimos conectar. Revisá tu internet y probá de nuevo.");
    } finally { enCurso.current = false; setOcupado(false); }
  }

  if (!t) return (
    <main className="club">
      <h1>No encontramos tu tarjeta</h1>
      <p role="alert" className="alerta">Escaneá de nuevo el QR del local o pedile que te reenvíe el link.</p>
    </main>
  );

  const c = casilleros(t.sellos, t.meta);
  const falta = faltan(t.sellos, t.meta);
  return (
    <main className="club">
      <p className="mut">{t.local}</p>
      <h1>Hola, {t.cliente}</h1>
      {c.total > 0 && (
        <ol className="club-casilleros" aria-label={`${t.sellos} de ${t.meta} sellos`}>
          {Array.from({ length: c.total }, (_, i) => <li key={i} className={i < c.llenos ? "lleno" : ""} aria-hidden="true">{i < c.llenos ? "✔" : ""}</li>)}
        </ol>
      )}
      <p className="club-cuenta" role="status" aria-live="polite"><b>{t.sellos}</b>{t.meta ? ` de ${t.meta} sellos` : t.sellos === 1 ? " sello" : " sellos"}</p>
      {t.listo
        ? <div className="card club-premio"><b>¡Tenés tu premio!</b><p>{t.premio ? `${t.premio}. ` : ""}Mostrale esta pantalla al kiosquero para canjearlo.</p></div>
        : falta > 0 && t.premio && <p>Te faltan {falta} para <b>{t.premio}</b>.</p>}

      <button className="btn-grande" onClick={sumar} disabled={ocupado || !t.puede_sumar}>{ocupado ? "Sumando…" : "Sumar mi compra"}</button>
      {t.bloqueo && <p className="mut">{textoBloqueo(t.bloqueo)}</p>}
      {msg && <p role="status" aria-live="polite" className={msg.startsWith("¡Listo") ? "" : "alerta"}>{msg}</p>}
      {t.puede_sumar && <p className="mut">Tocá el botón solo después de pagar tu compra{t.por_compra ? ` y sumás ${t.por_compra} sello${t.por_compra === 1 ? "" : "s"}` : ""}. El local ve cada sello que sumás.</p>}

      {/* Descargar la tarjeta como app: botón nativo en Android/Chrome, pasos de Safari en iPhone. No aparece si ya está instalada. */}
      <div style={{ marginTop: 16 }}><InstalarApp block /></div>

      {t.historial.length > 0 && (
        <details>
          <summary>Mis últimos sellos</summary>
          <ul>{t.historial.map((h, i) => <li key={i}>{dia(h.fecha)} · +{h.cantidad}</li>)}</ul>
        </details>
      )}
      <details>
        <summary>Guardar esta tarjeta en mi celular</summary>
        <p><b>Android (Chrome):</b> menú ⋮ → Instalar app.</p>
        <p><b>iPhone (Safari):</b> Compartir → Agregar a pantalla de inicio.</p>
      </details>
    </main>
  );
}
