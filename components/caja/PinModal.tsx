"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";

// PIN de supervisor. El servidor lo verifica (pos_pin_verificar): bloquea tras 5 fallos en 10 min y entrega un token
// de un solo uso que vence a los 2 minutos. El PIN nunca se guarda ni se compara en el navegador.
export function PinModal({ kioscoId, titulo, onToken, onCancelar }: { kioscoId: string; titulo: string; onToken: (t: string | null) => void; onCancelar: () => void }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  async function verificar() {
    if (ocupado || pin.length < 4) return;
    setOcupado(true); setErr("");
    const { data, error } = await supabase.rpc("pos_pin_verificar", { p_kiosco: kioscoId, p_pin: pin });
    setOcupado(false);
    if (error) { setErr("No pudimos verificar el PIN. Revisá tu conexión e intentá de nuevo."); return; }
    const r = data as { ok: boolean; sin_pin?: boolean; token?: string; bloqueado?: boolean; restantes?: number };
    if (r.ok) return onToken(r.sin_pin ? null : (r.token ?? null));
    setPin("");
    setErr(r.bloqueado ? "Demasiados intentos fallidos. Esperá 10 minutos para volver a probar." : `PIN incorrecto. Te quedan ${r.restantes ?? 0} ${r.restantes === 1 ? "intento" : "intentos"}.`);
    input.current?.focus();
  }

  return (
    <div className="pos-overlay" role="dialog" aria-modal="true" aria-label="PIN de supervisor" style={{ zIndex: 120 }}>
      <div className="pos-modal" style={{ maxWidth: 380 }}>
        <div className="pos-modal-head"><h2>PIN de supervisor</h2></div>
        <p className="mut">{titulo}</p>
        <label>PIN
          <input ref={input} type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); void verificar(); } if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancelar(); } }} />
        </label>
        {err && <p className="pos-error" role="alert">{err}</p>}
        <div className="pos-modal-acciones">
          <button className="sec" onClick={onCancelar}>Cancelar</button>
          <button disabled={ocupado || pin.length < 4} onClick={verificar}>{ocupado ? "Verificando…" : "Confirmar"}</button>
        </div>
      </div>
    </div>
  );
}

// Hook para pedir el PIN "en el momento": const t = await pedir("Anular venta #5").
// Resuelve con el token (string), null si el kiosco no tiene PIN, o undefined si el cajero canceló.
export function usePin(kioscoId: string): { pedir: (titulo: string) => Promise<string | null | undefined>; modal: ReactNode } {
  const [pend, setPend] = useState<{ titulo: string; resolver: (t: string | null | undefined) => void } | null>(null);
  const pedir = useCallback((titulo: string) => new Promise<string | null | undefined>((resolver) => setPend({ titulo, resolver })), []);
  const modal = pend ? <PinModal kioscoId={kioscoId} titulo={pend.titulo} onToken={(t) => { pend.resolver(t); setPend(null); }} onCancelar={() => { pend.resolver(undefined); setPend(null); }} /> : null;
  return { pedir, modal };
}
