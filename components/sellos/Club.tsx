"use client";
import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { supabase, type Kiosco } from "@/lib/supabase";
import { ajustesDesdeForm, esMedioDigital, linkClub, nombreMedio, resumenLimites, type ActividadClub } from "@/lib/club";
import { mensajeErrorSql } from "@/lib/errores";
import { vistaPreviaMeta, type Campana, type Premio } from "@/lib/fidelidad";
import HorasFlojas from "./HorasFlojas";
import PremiosListos from "./PremiosListos";
import PapelitosClub from "./PapelitosClub";
import Rentabilidad from "./Rentabilidad";
import Avisos from "@/components/Avisos";

const hora = (s: string) => new Date(s).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires" });
const REFRESCO_MS = 20000;

function partir(ctx: CanvasRenderingContext2D, texto: string, ancho: number): string[] {
  const out: string[] = []; let linea = "";
  for (const p of texto.split(" ")) { const prueba = linea ? `${linea} ${p}` : p; if (ctx.measureText(prueba).width > ancho && linea) { out.push(linea); linea = p; } else linea = prueba; }
  if (linea) out.push(linea); return out;
}

/** Cartel imprimible con el QR: se dibuja en un canvas y se baja como imagen. */
async function descargarCartel(kiosco: Kiosco, url: string, premio: Premio | null) {
  const tienda = kiosco.tienda_activa !== false;
  const W = 1080, H = tienda ? 1640 : 1528, c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const css = getComputedStyle(document.documentElement);
  const tinta = css.getPropertyValue("--ink").trim() || "#14181d";
  const fondo = css.getPropertyValue("--surface").trim() || "#ffffff";
  const senal = css.getPropertyValue("--signal").trim() || "#ffc61a";
  g.fillStyle = fondo; g.fillRect(0, 0, W, H);
  g.fillStyle = senal; g.fillRect(0, 0, W, 40); g.fillRect(0, H - 40, W, 40);
  g.strokeStyle = tinta; g.lineWidth = 10; g.strokeRect(30, 70, W - 60, H - 140);
  g.fillStyle = tinta; g.textAlign = "center";
  g.font = "800 84px system-ui, sans-serif";
  let y = 190; for (const l of partir(g, "Sumá sellos en cada compra", W - 200)) { g.fillText(l, W / 2, y); y += 98; }
  g.font = "600 52px system-ui, sans-serif";
  if (premio) for (const l of partir(g, `Juntá ${premio.costo_sellos} y llevate ${premio.nombre}`, W - 220)) { g.fillText(l, W / 2, y + 30); y += 64; }
  const qr = new Image(); qr.src = await QRCode.toDataURL(url, { width: 640, margin: 1, errorCorrectionLevel: "M" });
  await new Promise((r) => { qr.onload = r; });
  g.drawImage(qr, (W - 640) / 2, y + 60, 640, 640);
  g.font = "700 50px system-ui, sans-serif"; y += 790;
  for (const t of ["1. Escaneá el QR y creá tu tarjeta (una sola vez)", "2. Después de pagar, abrí tu tarjeta", "3. Elegí cómo pagaste y sumá tu sello"]) { for (const l of partir(g, t, W - 220)) { g.fillText(l, W / 2, y); y += 62; } y += 14; }
  g.font = "600 40px system-ui, sans-serif";
  if (tienda) for (const l of partir(g, "También podés ver el catálogo y hacer tu pedido desde ahí", W - 220)) { g.fillText(l, W / 2, y + 10); y += 50; }
  g.fillText(kiosco.nombre, W / 2, H - 90);
  c.toBlob((b) => {
    if (!b) return;
    const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `cartel-club-${kiosco.slug}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, "image/png");
}

export default function Club({ kiosco, premios, campanas, onCambio }: { kiosco: Kiosco; premios: Premio[]; campanas: Campana[]; onCambio: () => void }) {
  const [act, setAct] = useState<ActividadClub[] | null>(null);
  const [msg, setMsg] = useState("");
  const [png, setPng] = useState("");
  const [copiado, setCopiado] = useState(false);
  const url = typeof window !== "undefined" ? linkClub(kiosco.slug, location.origin) : "";

  const principal = [...premios].filter((p) => p.activo).sort((a, b) => a.costo_sellos - b.costo_sellos)[0] ?? null;
  const [pNombre, setPNombre] = useState(principal?.nombre ?? "");
  const [pCosto, setPCosto] = useState(String(principal?.costo_sellos ?? 10));
  useEffect(() => { setPNombre(principal?.nombre ?? ""); setPCosto(String(principal?.costo_sellos ?? 10)); }, [principal?.id, principal?.nombre, principal?.costo_sellos]); // eslint-disable-line react-hooks/exhaustive-deps

  const [aj, setAj] = useState({
    activo: kiosco.club_activo ?? true,
    maxDia: kiosco.club_max_por_dia === undefined ? "1" : kiosco.club_max_por_dia === null ? "" : String(kiosco.club_max_por_dia),
    espera: kiosco.club_espera_min ? String(kiosco.club_espera_min) : "",
    horario: !!(kiosco.club_hora_desde && kiosco.club_hora_hasta),
    desde: kiosco.club_hora_desde?.slice(0, 5) ?? "08:00", hasta: kiosco.club_hora_hasta?.slice(0, 5) ?? "22:00",
  });
  const [guardado, setGuardado] = useState(() => ajustesDesdeForm(aj));

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc("club_actividad", { p_kiosco: kiosco.id, p_horas: 24 });
    if (!error) setAct((data as ActividadClub[]) ?? []);
  }, [kiosco.id]);
  useEffect(() => {
    void cargar();
    const t = setInterval(() => { if (document.visibilityState === "visible") void cargar(); }, REFRESCO_MS);
    return () => clearInterval(t);
  }, [cargar]);
  useEffect(() => { if (url) QRCode.toDataURL(url, { width: 512, margin: 1, errorCorrectionLevel: "M" }).then(setPng); }, [url]);

  async function rechazar(e: ActividadClub, rechazar: boolean) {
    setMsg("");
    const { data, error } = await supabase.rpc("club_rechazar", { p_evento: e.evento, p_rechazar: rechazar });
    if (error) return setMsg(mensajeErrorSql(error.message, "club"));
    const descubierto = Number((data as { descubierto?: number } | null)?.descubierto ?? 0);
    setMsg(rechazar
      ? `Rechazaste el sello de ${e.nombre}. Podés deshacerlo.${descubierto > 0 ? ` Ojo: ya había canjeado un premio con ${descubierto === 1 ? "ese sello" : `${descubierto} de esos sellos`}; su saldo queda en 0.` : ""}`
      : `Volvió el sello de ${e.nombre}.`);
    await cargar();
  }

  async function verificar(e: ActividadClub) {
    setMsg("");
    const { error } = await supabase.rpc("club_verificar", { p_evento: e.evento });
    if (error) return setMsg(mensajeErrorSql(error.message, "club"));
    setMsg(`Confirmaste el sello de ${e.nombre}.`);
    await cargar();
  }

  const meta = vistaPreviaMeta(pNombre, pCosto);

  async function guardarPremio() {
    setMsg("");
    const costo = Number(pCosto), nombre = pNombre.trim();
    if (!nombre || nombre.length > 80) return setMsg("Escribí el premio (hasta 80 letras).");
    if (!Number.isInteger(costo) || costo < 1 || costo > 1000) return setMsg("Los sellos para el premio tienen que ser un número entero entre 1 y 1000.");
    const { error } = principal
      ? await supabase.from("fidelidad_premios").update({ nombre, costo_sellos: costo }).eq("id", principal.id)
      : await supabase.from("fidelidad_premios").insert({ kiosco_id: kiosco.id, nombre, costo_sellos: costo, tipo: "libre" });
    if (error) return setMsg("No se pudo guardar el premio.");
    setMsg("Premio guardado"); onCambio();
  }

  async function guardarLimites() {
    setMsg("");
    const r = ajustesDesdeForm(aj);
    if (!r.ok) return setMsg(r.error);
    const { error } = await supabase.from("kioscos").update(r.datos).eq("id", kiosco.id);
    if (error) return setMsg("No se pudieron guardar los límites.");
    setGuardado(r); setMsg("Límites guardados");
  }

  async function copiar() { try { await navigator.clipboard.writeText(url); setCopiado(true); setTimeout(() => setCopiado(false), 2500); } catch { setCopiado(false); } }

  const hoy = (act ?? []).filter((e) => !e.rechazado);
  const porVerificar = hoy.filter((e) => esMedioDigital(e.medio) && e.verificado === false).length;
  return (
    <>
      <div className="card">
        <h3>Sellos de las últimas 24 horas</h3>
        <p className="mut" style={{ marginTop: 0 }}>Cada sello nuevo te llega como aviso: rechazalo si el cliente no compró y confirmá los de transferencia o Mercado Pago.</p>
        {act === null && <p className="mut">Cargando…</p>}
        {act && act.length === 0 && <p className="mut">Todavía nadie sumó. Pegá el cartel con el QR en el mostrador (más abajo) para empezar.</p>}
        {act && act.length > 0 && <p className="mut">{hoy.length} sello{hoy.length === 1 ? "" : "s"} válido{hoy.length === 1 ? "" : "s"}{porVerificar > 0 ? ` · ${porVerificar} por verificar con comprobante` : ""}.</p>}
        {(act ?? []).map((e) => (
          <div className="row fila-sep" key={e.evento}>
            <span style={{ textDecoration: e.rechazado ? "line-through" : undefined }}>
              <b>{e.nombre}</b> · +{e.cantidad} · {hora(e.cuando)}{e.nuevo ? " · cliente nuevo" : ""}{e.medio ? ` · ${nombreMedio(e.medio)}` : ""}{esMedioDigital(e.medio) && !e.rechazado ? (e.verificado ? " · ✔ verificado" : " · por verificar") : ""}
            </span>
            <span style={{ display: "flex", gap: 6 }}>
              {!e.rechazado && esMedioDigital(e.medio) && e.verificado === false && <button type="button" onClick={() => verificar(e)}>Confirmar</button>}
              {e.rechazado
                ? <button type="button" className="sec" onClick={() => rechazar(e, false)}>Deshacer</button>
                : <button type="button" className="sec" onClick={() => rechazar(e, true)}>Rechazar</button>}
            </span>
          </div>
        ))}
      </div>
      {msg && <p role="status" className="mut">{msg}</p>}

      <PremiosListos kiosco={kiosco} premio={principal} />

      <PapelitosClub kiosco={kiosco} />

      <div className="card">
        <h3>Tu premio</h3>
        <label>Qué se llevan<input value={pNombre} maxLength={80} onChange={(e) => setPNombre(e.target.value)} placeholder="Ej: Gaseosa 500 ml" /></label>
        <label>Cada cuántos sellos<input inputMode="numeric" value={pCosto} onChange={(e) => setPCosto(e.target.value)} /></label>
        <div className="fila-sep" aria-live="polite">
          <b>Así lo verá el cliente</b>
          <p>{meta.texto}</p>
          {meta.casilleros > 0 && <ol className="club-casilleros" aria-hidden="true">{Array.from({ length: meta.casilleros }, (_, i) => <li key={i} />)}</ol>}
        </div>
        <button type="button" onClick={guardarPremio}>Guardar premio</button>
        <p className="mut">Cuando el cliente completa la tarjeta te muestra la pantalla y lo canjeás desde Clientes. Otros premios y reglas: pestañas “Cómo se suman” y “Premios”.</p>
      </div>

      <Rentabilidad kiosco={kiosco} onCambio={onCambio} />

      <HorasFlojas kiosco={kiosco} campanas={campanas} onCambio={onCambio} />

      <div className="card qr-card">
        {png && <img src={png} alt={`QR del club de ${kiosco.nombre}`} width={96} height={96} />}
        <div className="qr-datos">
          <b>QR del mostrador</b>
          <p className="mut" style={{ margin: ".15rem 0 .5rem" }}>El cliente lo escanea una sola vez y se crea su tarjeta.{kiosco.tienda_activa !== false ? " Desde su tarjeta también puede ver tu catálogo: es el mismo QR de tu tienda." : ""}</p>
          <p className="mut qr-url">{url}</p>
          <div className="qr-acciones">
            <button type="button" onClick={() => descargarCartel(kiosco, url, principal)}>Descargar cartel</button>
            <button type="button" className="sec" onClick={copiar}>{copiado ? "Link copiado" : "Copiar link"}</button>
          </div>
        </div>
      </div>

      <Avisos kiosco={kiosco} />

      <details className="card">
        <summary><b>Límites (opcional)</b> · {resumenLimites(guardado.ok ? guardado.datos : { club_activo: true, club_max_por_dia: 1, club_espera_min: null, club_hora_desde: null, club_hora_hasta: null })}</summary>
        <p className="mut">Sirven para evitar abusos. Si no tocás nada, cada cliente puede sumar 1 sello por día.</p>
        <label><input type="checkbox" checked={aj.activo} onChange={(e) => setAj({ ...aj, activo: e.target.checked })} /> Club activo (destildalo para pausar los sellos)</label>
        <label>Sellos por día, como máximo
          <select value={aj.maxDia} onChange={(e) => setAj({ ...aj, maxDia: e.target.value })}>
            <option value="1">1 por día</option><option value="2">2 por día</option><option value="3">3 por día</option><option value="5">5 por día</option><option value="">Sin tope</option>
          </select>
        </label>
        <label>Espera entre un sello y el siguiente
          <select value={aj.espera} onChange={(e) => setAj({ ...aj, espera: e.target.value })}>
            <option value="">Sin espera</option><option value="15">15 minutos</option><option value="30">30 minutos</option><option value="60">1 hora</option><option value="120">2 horas</option><option value="240">4 horas</option>
          </select>
        </label>
        <label><input type="checkbox" checked={aj.horario} onChange={(e) => setAj({ ...aj, horario: e.target.checked })} /> Solo sumar en un horario</label>
        {aj.horario && (
          <div className="row" style={{ justifyContent: "flex-start", gap: 8 }}>
            <label>Desde<input type="time" value={aj.desde} onChange={(e) => setAj({ ...aj, desde: e.target.value })} /></label>
            <label>Hasta<input type="time" value={aj.hasta} onChange={(e) => setAj({ ...aj, hasta: e.target.value })} /></label>
          </div>
        )}
        <button type="button" onClick={guardarLimites}>Guardar límites</button>
        <p className="mut">Otras reglas (sellos dobles, días, montos) están en “Cómo se suman” y también se aplican al club.</p>
      </details>
    </>
  );
}
