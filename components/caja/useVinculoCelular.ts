"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { borrarVinculo, guardarVinculo, leerVinculo, limpiarCodigo, nombreCanal, nuevaExpiracion, nuevoToken, urlVinculo } from "@/lib/pos/remoto";

export type EstadoVinculo = "inactivo" | "esperando" | "conectado";
const EXTENDER_CADA_MS = 60_000;

// Lado de la caja del vínculo con el celular. El vínculo sigue vivo aunque se oculte la ventana del QR y se retoma
// al recargar la página (se guarda en este navegador). Solo "Cerrar vínculo" o la inactividad lo cortan.
export function useVinculoCelular({ kioscoId, onCodigo }: { kioscoId: string; onCodigo: (codigo: string) => void }) {
  const [estado, setEstado] = useState<EstadoVinculo>("inactivo");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [ultimo, setUltimo] = useState("");
  const cb = useRef(onCodigo); cb.current = onCodigo;
  const canal = useRef<RealtimeChannel | null>(null);
  const token = useRef<string | null>(null);
  const expira = useRef(0);
  const ultimaExt = useRef(0);
  const timerExp = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerRec = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentos = useRef(0);

  const soltarCanal = useCallback(() => {
    if (timerRec.current) { clearTimeout(timerRec.current); timerRec.current = null; }
    if (canal.current) { void supabase.removeChannel(canal.current); canal.current = null; }
  }, []);

  const cortar = useCallback((aviso: string, avisarAlCelular: boolean) => {
    if (avisarAlCelular && canal.current) void canal.current.send({ type: "broadcast", event: "cerrado", payload: {} }).catch(() => {});
    // Pequeña demora para que el aviso salga antes de soltar el canal.
    const c = canal.current; canal.current = null;
    if (c) setTimeout(() => { void supabase.removeChannel(c); }, avisarAlCelular ? 300 : 0);
    soltarCanal();
    if (timerExp.current) { clearTimeout(timerExp.current); timerExp.current = null; }
    token.current = null; intentos.current = 0;
    borrarVinculo(window.localStorage, kioscoId);
    setEstado("inactivo"); setUrl(""); setUltimo(""); setError(aviso);
  }, [kioscoId, soltarCanal]);

  const programarVencimiento = useCallback(() => {
    if (timerExp.current) clearTimeout(timerExp.current);
    const ms = expira.current - Date.now();
    timerExp.current = setTimeout(() => cortar("El vínculo con el celular venció por inactividad. Generá uno nuevo si lo necesitás.", true), Math.max(0, ms));
  }, [cortar]);

  const suscribir = useCallback((t: string) => {
    soltarCanal();
    const ch = supabase.channel(nombreCanal(t), { config: { broadcast: { self: false } } });
    canal.current = ch;
    ch.on("broadcast", { event: "listo" }, () => { if (token.current === t) setEstado("conectado"); })
      .on("broadcast", { event: "codigo" }, ({ payload }) => {
        if (token.current !== t) return;
        const c = limpiarCodigo((payload as { codigo?: unknown } | null)?.codigo);
        if (!c) return;
        setEstado("conectado"); setUltimo(c);
        if (navigator.vibrate) navigator.vibrate(60);
        // Vencimiento deslizante: mientras se usa, no se corta a mitad de turno.
        const ahora = Date.now();
        if (ahora - ultimaExt.current > EXTENDER_CADA_MS) {
          ultimaExt.current = ahora; expira.current = nuevaExpiracion(ahora);
          guardarVinculo(window.localStorage, { token: t, kiosco: kioscoId, expira_at: expira.current });
          programarVencimiento();
        }
        cb.current(c);
      })
      .subscribe((st) => {
        if (token.current !== t) return;
        if (st === "SUBSCRIBED") {
          intentos.current = 0;
          // Si el celular ya estaba conectado (se recargó la caja), contesta "listo" y no queda en "esperando".
          void ch.send({ type: "broadcast", event: "ping", payload: {} }).catch(() => {});
        } else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") {
          if (timerRec.current) return;
          const espera = Math.min(1000 * 2 ** intentos.current, 15_000); intentos.current += 1;
          timerRec.current = setTimeout(() => { timerRec.current = null; if (token.current === t) suscribir(t); }, espera);
        }
      });
  }, [kioscoId, programarVencimiento, soltarCanal]);

  const vincular = useCallback(() => {
    if (token.current) return; // ya hay uno vivo: se reutiliza
    const t = nuevoToken();
    token.current = t; expira.current = nuevaExpiracion(Date.now()); ultimaExt.current = Date.now();
    guardarVinculo(window.localStorage, { token: t, kiosco: kioscoId, expira_at: expira.current });
    setUrl(urlVinculo(window.location.origin, t)); setError(""); setUltimo(""); setEstado("esperando");
    suscribir(t); programarVencimiento();
  }, [kioscoId, programarVencimiento, suscribir]);

  const cerrar = useCallback(() => cortar("", true), [cortar]);

  // Al abrir la caja: retomar un vínculo vigente de este kiosco sin pedir otro QR.
  useEffect(() => {
    const g = leerVinculo(window.localStorage, kioscoId, Date.now());
    if (g) {
      token.current = g.token; expira.current = g.expira_at; ultimaExt.current = Date.now();
      setUrl(urlVinculo(window.location.origin, g.token)); setEstado("esperando");
      suscribir(g.token); programarVencimiento();
    }
    return () => { // salir de la pantalla no corta el vínculo guardado; solo suelta el canal y los timers de este montaje
      if (timerExp.current) clearTimeout(timerExp.current);
      soltarCanal(); token.current = null;
    };
  }, [kioscoId, programarVencimiento, soltarCanal, suscribir]);

  return { estado, url, error, ultimo, vincular, cerrar };
}
