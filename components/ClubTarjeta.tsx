"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { CLUB_TOKEN_RE, CODIGO_CLUB_RE, casilleros, claveTokenLocal, esMedioDigital, faltan, linkInvitacion, linkTienda, mensajeInvitacion, normalizarCodigoClub, textoBloqueo, type MedioClub, type Tarjeta } from "@/lib/club";
import { linkWhatsApp } from "@/lib/whatsapp";
import { mensajeErrorSql } from "@/lib/errores";
import InstalarApp from "@/components/panel/InstalarApp";

const dia = (s: string) => new Date(s).toLocaleDateString("es-AR", { day: "numeric", month: "short" });

// Tarjeta del cliente: sus sellos y el botón "Sumar mi compra". Se instala en el celular como app (manifest propio).
export default function ClubTarjeta({ token, inicial }: { token: string; inicial: Tarjeta | null }) {
  const [t, setT] = useState<Tarjeta | null>(inicial);
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const enCurso = useRef(false);
  const [pidiendoCodigo, setPidiendoCodigo] = useState(false); // el local exige papelito para efectivo
  const [codigo, setCodigo] = useState("");
  const [cumple, setCumple] = useState({ dia: "", mes: "" });
  const [msgCumple, setMsgCumple] = useState("");

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

  async function sumar(medio: MedioClub, cod?: string) {
    if (enCurso.current) return; // dos toques seguidos no mandan dos pedidos
    enCurso.current = true; setOcupado(true); setMsg("");
    try {
      const r = await fetch("/api/club/sumar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, medio, codigo: cod }) });
      const j = await r.json();
      if (!r.ok) {
        setMsg(mensajeErrorSql(j.error, "club"));
        // Error de papelito: el campo queda abierto para reintentar; se limpia salvo que el local lo haya frenado.
        if (String(j.error).startsWith("club_codigo_")) { setPidiendoCodigo(true); if (j.error !== "club_codigo_bloqueado") setCodigo(""); }
        await recargar(); return;
      }
      setPidiendoCodigo(false); setCodigo("");
      setT(j as Tarjeta);
      setMsg(`¡Listo! Llevás ${(j as Tarjeta).sellos}${(j as Tarjeta).meta ? ` de ${(j as Tarjeta).meta}` : ""}.${esMedioDigital(medio) ? " El local lo va a confirmar con tu comprobante." : ""}`);
    } catch {
      setMsg("No pudimos conectar. Revisá tu internet y probá de nuevo.");
    } finally { enCurso.current = false; setOcupado(false); }
  }

  async function guardarCumple(e: React.FormEvent) {
    e.preventDefault(); setMsgCumple("");
    const dia = Number(cumple.dia), mes = Number(cumple.mes);
    if (!Number.isInteger(dia) || !Number.isInteger(mes) || dia < 1 || dia > 31 || mes < 1 || mes > 12) return setMsgCumple("Escribí el día (1 a 31) y el mes (1 a 12).");
    const { data, error } = await supabase.rpc("club_guardar_cumple", { p_token: token, p_dia: dia, p_mes: mes });
    if (error) return setMsgCumple(mensajeErrorSql(error.message, "club"));
    setT(data as Tarjeta); setMsgCumple("¡Listo! Anotamos tu cumpleaños.");
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
      {t.tienda && <a className="btn-grande" href={linkTienda(t.slug)} style={{ display: "block", textAlign: "center", marginBottom: 12 }}>Ver catálogo y hacer un pedido</a>}
      {c.total > 0 && (
        <ol className="club-casilleros" aria-label={`${t.sellos} de ${t.meta} sellos`}>
          {Array.from({ length: c.total }, (_, i) => <li key={i} className={i < c.llenos ? "lleno" : ""} aria-hidden="true">{i < c.llenos ? "✔" : ""}</li>)}
        </ol>
      )}
      <p className="club-cuenta" role="status" aria-live="polite"><b>{t.sellos}</b>{t.meta ? ` de ${t.meta} sellos` : t.sellos === 1 ? " sello" : " sellos"}</p>
      {t.listo
        ? <div className="card club-premio"><b>¡Tenés tu premio!</b><p>{t.premio ? `${t.premio}. ` : ""}Mostrale esta pantalla al kiosquero para canjearlo.</p></div>
        : falta > 0 && t.premio && <p>Te faltan {falta} para <b>{t.premio}</b>.</p>}

      {t.niveles && t.niveles.length > 1 && (
        <section aria-label="Premios por nivel">
          <h2>Tus premios</h2>
          <ul>{t.niveles.map((n, i) => <li key={i}>{n.alcanzado ? "✔ " : ""}{n.nombre} · {n.costo_sellos} sellos{n.alcanzado ? " · ¡lo alcanzaste!" : ""}</li>)}</ul>
          {t.proximo && <p>Te faltan {t.proximo.faltan} sello{t.proximo.faltan === 1 ? "" : "s"} para <b>{t.proximo.nombre}</b>.</p>}
        </section>
      )}
      {t.sorteo && (
        <div className="card">
          <b>Sorteo: {t.sorteo.nombre}</b>
          <p>Cada papelito que uses hasta el {t.sorteo.hasta.split("-").reverse().join("/")} es una chance. Tenés {t.sorteo.mis_chances} chance{t.sorteo.mis_chances === 1 ? "" : "s"}.</p>
        </div>
      )}

      <p className="mut" style={{ marginBottom: 6 }}>¿Cómo pagaste tu compra?</p>
      {t.exige_codigo && pidiendoCodigo
        ? (
          <form onSubmit={(e) => { e.preventDefault(); const c = normalizarCodigoClub(codigo); if (!CODIGO_CLUB_RE.test(c)) { setMsg("Escribí los 6 caracteres del papelito."); return; } void sumar("efectivo", c); }} style={{ display: "grid", gap: 8 }}>
            <label htmlFor="club-codigo">Código del papelito (el que te dio el local)</label>
            <input id="club-codigo" value={codigo} onChange={(e) => setCodigo(e.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={12} inputMode="text" />
            <button className="btn-grande" type="submit" disabled={ocupado || !t.puede_sumar}>{ocupado ? "Sumando…" : "Sumar con efectivo"}</button>
            <button className="sec" type="button" onClick={() => { setPidiendoCodigo(false); setMsg(""); }}>Cancelar</button>
          </form>
        )
        : <button className="btn-grande" onClick={() => (t.exige_codigo ? setPidiendoCodigo(true) : sumar("efectivo"))} disabled={ocupado || !t.puede_sumar}>{ocupado ? "Sumando…" : "Pagué en efectivo"}</button>
      }
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button className="sec" onClick={() => sumar("transferencia")} disabled={ocupado || !t.puede_sumar}>Transferencia</button>
        <button className="sec" onClick={() => sumar("mercadopago")} disabled={ocupado || !t.puede_sumar}>Mercado Pago</button>
      </div>
      {t.bloqueo && <p className="mut">{textoBloqueo(t.bloqueo)}</p>}
      {msg && <p role="status" aria-live="polite" className={msg.startsWith("¡Listo") ? "" : "alerta"}>{msg}</p>}
      {t.puede_sumar && <p className="mut">Tocá solo después de pagar tu compra{t.por_compra ? ` y sumás ${t.por_compra} sello${t.por_compra === 1 ? "" : "s"}` : ""}. El local ve cada sello que sumás; si pagaste por transferencia o Mercado Pago, te pueden pedir el comprobante.</p>}

      {t.hay_cumple && !t.cumple_mes && (
        <form onSubmit={guardarCumple} className="card">
          <b>Tu regalo de cumpleaños</b>
          <p className="mut">Contanos tu día y mes de cumpleaños y en ese mes sumás un sello de regalo.</p>
          <label>Día<input inputMode="numeric" maxLength={2} value={cumple.dia} onChange={(e) => setCumple({ ...cumple, dia: e.target.value })} /></label>
          <label>Mes (número)<input inputMode="numeric" maxLength={2} value={cumple.mes} onChange={(e) => setCumple({ ...cumple, mes: e.target.value })} /></label>
          <button type="submit">Guardar</button>
          {msgCumple && <p role="status" aria-live="polite" className={msgCumple.startsWith("¡Listo") ? "" : "alerta"}>{msgCumple}</p>}
        </form>
      )}
      {t.hay_cumple && t.cumple_mes && <p className="mut">Tu cumpleaños: {t.cumple_dia}/{t.cumple_mes}. En ese mes sumás tu sello de regalo.</p>}
      {t.hay_referido && t.ref && (
        <div className="card">
          <b>Traé un amigo</b>
          <p className="mut">Si se registra con tu link, los dos suman sellos.</p>
          <a className="btn" href={linkWhatsApp("", mensajeInvitacion(t.local, linkInvitacion(t.slug, t.ref, typeof window === "undefined" ? "" : window.location.origin)))}>Invitar por WhatsApp</a>
        </div>
      )}

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
