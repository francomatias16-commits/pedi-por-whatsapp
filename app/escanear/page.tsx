"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { esLinkPropio, nombreCanal, tokenValido } from "@/lib/pos/remoto";

type Estado = "iniciando" | "activo" | "cerrado" | "error";
const COOLDOWN_MS = 1200;

// Página que abre el celular al escanear el QR de la caja: lee códigos de barras con la cámara y los manda a la caja.
export default function Escanear() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [estado, setEstado] = useState<Estado>("iniciando");
  const [msg, setMsg] = useState("");
  const [camaraErr, setCamaraErr] = useState("");
  const [enviado, setEnviado] = useState("");
  const token = useRef<string | null>(null);
  const sb = useRef<SupabaseClient | null>(null);
  const canal = useRef<RealtimeChannel | null>(null);
  const canalListo = useRef(false);
  const camaraLista = useRef(false);
  const controls = useRef<{ stop: () => void } | null>(null);
  const ultimo = useRef({ c: "", t: 0 });
  const cerrado = useRef(false);

  const avisarListo = useCallback(() => {
    if (!camaraLista.current || !canalListo.current || !canal.current) return;
    void canal.current.send({ type: "broadcast", event: "listo", payload: {} }).catch(() => {});
  }, []);

  const parar = useCallback(() => {
    camaraLista.current = false;
    try { controls.current?.stop(); } catch { /* ya parada */ }
    controls.current = null;
    const v = videoRef.current; const s = v?.srcObject as MediaStream | null;
    if (s) { s.getTracks().forEach((t) => t.stop()); if (v) v.srcObject = null; }
  }, []);

  const conectarCanal = useCallback(() => {
    if (!sb.current || !token.current) return;
    canalListo.current = false;
    if (canal.current) { void sb.current.removeChannel(canal.current); canal.current = null; }
    const ch = sb.current.channel(nombreCanal(token.current), { config: { broadcast: { self: false } } });
    canal.current = ch;
    ch.on("broadcast", { event: "ping" }, () => avisarListo())
      .on("broadcast", { event: "cerrado" }, () => { cerrado.current = true; parar(); setEstado("cerrado"); setMsg("La caja cerró el vínculo. Para seguir, generá un QR nuevo desde la caja."); })
      .subscribe((st) => { if (st === "SUBSCRIBED") { canalListo.current = true; avisarListo(); } });
  }, [avisarListo, parar]);

  const iniciarCamara = useCallback(async () => {
    if (cerrado.current) return;
    if (!navigator.mediaDevices?.getUserMedia) { setCamaraErr("Este navegador no permite usar la cámara. Probá con Chrome o Safari actualizados."); return; }
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const { DecodeHintType, BarcodeFormat } = await import("@zxing/library");
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128]);
      const reader = new BrowserMultiFormatReader(hints);
      controls.current = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, videoRef.current!, (result) => {
        if (!result) return;
        const codigo = result.getText();
        if (!codigo || esLinkPropio(codigo)) return; // el primer cuadro puede leer el QR de la pantalla de la caja
        const ahora = Date.now();
        if (codigo === ultimo.current.c && ahora - ultimo.current.t < COOLDOWN_MS) return;
        ultimo.current = { c: codigo, t: ahora };
        if (navigator.vibrate) navigator.vibrate(60);
        setEnviado(codigo);
        void canal.current?.send({ type: "broadcast", event: "codigo", payload: { codigo } }).catch(() => {});
      });
      camaraLista.current = true; setCamaraErr(""); avisarListo();
    } catch (e) {
      const n = e instanceof Error ? e.name : "";
      setCamaraErr(n === "NotAllowedError" || n === "PermissionDeniedError" ? "Hace falta el permiso de la cámara. Habilitalo en el navegador y recargá la página."
        : n === "NotFoundError" ? "No encontramos ninguna cámara en este dispositivo."
        : location.protocol !== "https:" && location.hostname !== "localhost" ? "La cámara solo funciona con conexión segura (https)." : "No pudimos abrir la cámara.");
    }
  }, [avisarListo]);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t");
    if (!tokenValido(t)) { setEstado("error"); setMsg("El link está incompleto. Volvé a escanear el QR desde la caja."); return; }
    token.current = t;
    sb.current = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    setEstado("activo");
    conectarCanal(); void iniciarCamara();
    // Al minimizar el navegador el sistema corta la cámara: se pausa y se retoma sola al volver.
    const vis = () => { if (document.hidden) parar(); else if (!cerrado.current) { conectarCanal(); void iniciarCamara(); } };
    document.addEventListener("visibilitychange", vis);
    return () => { document.removeEventListener("visibilitychange", vis); parar(); if (canal.current && sb.current) void sb.current.removeChannel(canal.current); };
  }, [conectarCanal, iniciarCamara, parar]);

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "1rem" }}>
      <h1 style={{ fontSize: "1.4rem" }}>Lector de la caja</h1>
      {(estado === "error" || estado === "cerrado") && <p className="pos-error" role="alert">{msg}</p>}
      {estado === "activo" && (
        <>
          <video ref={videoRef} muted playsInline style={{ width: "100%", borderRadius: 10, background: "#000" }} />
          {camaraErr ? <p className="pos-error" role="alert">{camaraErr}</p> : <p className="mut">Apuntá al código de barras del producto. Cada lectura se suma sola al ticket de la caja.</p>}
          {enviado && <p className="pos-aviso" role="status">Enviado: <span className="mono">{enviado}</span></p>}
        </>
      )}
    </div>
  );
}
