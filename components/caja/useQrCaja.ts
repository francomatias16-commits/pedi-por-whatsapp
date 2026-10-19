"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type CobroSinVenta = { id: string; monto: number; creado: string; detalle: string | null; vigente: boolean };
export type QrCaja = { activo: boolean; sinVenta: CobroSinVenta[]; refrescar: () => Promise<void> };

// Estado del QR para la caja: si está encendido y listo, y qué cobros ya aprobados todavía no tienen venta.
// Si la consulta falla (sin internet), queda apagado: la caja sigue con los demás medios.
export function useQrCaja(kioscoId: string): QrCaja {
  const [activo, setActivo] = useState(false);
  const [sinVenta, setSinVenta] = useState<CobroSinVenta[]>([]);
  const refrescar = useCallback(async () => {
    const cfg = await supabase.rpc("qr_estado_config", { p_kiosco: kioscoId });
    if (cfg.error || !cfg.data) { setActivo(false); return; }
    const on = !!(cfg.data as { activo?: boolean }).activo;
    setActivo(on);
    if (!on) { setSinVenta([]); return; }
    const sv = await supabase.rpc("qr_cobros_sin_venta", { p_kiosco: kioscoId });
    if (!sv.error && Array.isArray(sv.data)) setSinVenta((sv.data as CobroSinVenta[]).map((c) => ({ ...c, monto: Number(c.monto) })));
  }, [kioscoId]);
  useEffect(() => {
    void refrescar();
    const on = () => void refrescar();
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, [refrescar]);
  return { activo, sinVenta, refrescar };
}
