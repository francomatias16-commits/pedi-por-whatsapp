"use client";
import Aviso from "@/components/ui/Aviso";
import { peso } from "@/lib/whatsapp";
import { hora } from "@/lib/caja";
import type { CobroSinVenta } from "./useQrCaja";

// Aviso de cobros con QR que entraron a Mercado Pago pero todavía no tienen venta en la caja.
export default function QrSinVenta({ cobros, enCierre = false }: { cobros: CobroSinVenta[]; enCierre?: boolean }) {
  if (!cobros.length) return null;
  const detalle = cobros.map((c) => `${peso(c.monto)} a las ${hora(c.creado)}${c.detalle === "aprobado_tarde" ? " (el cliente pagó cuando el cobro ya había vencido)" : ""}${!c.vigente ? " (de hace más de 12 horas)" : ""}`).join("; ");
  return (
    <Aviso tipo="alerta">
      <b>{cobros.length === 1 ? "Hay un cobro con QR sin venta: " : `Hay ${cobros.length} cobros con QR sin venta: `}</b>{detalle}.{" "}
      {enCierre
        ? "Esa plata ya entró a Mercado Pago pero no figura en ninguna venta. Antes de cerrar, registrá la venta con ese monto en QR o devolvela desde Mercado Pago."
        : "La plata ya entró a Mercado Pago. Al registrar una venta cobrada por QR con el mismo monto, se usa ese cobro. Si no corresponde a ninguna venta, devolvela desde Mercado Pago."}
    </Aviso>
  );
}
