"use client";
import { ETIQUETA_MEDIO, fecha, MEDIOS, type ReporteZ } from "@/lib/caja";
import { peso } from "@/lib/whatsapp";

// Reporte Z imprimible (también en pantalla).
export default function ReporteZView({ z, kioscoNombre }: { z: ReporteZ; kioscoNombre: string }) {
  const filaDif = z.diferencia;
  return (
    <div>
      <div className="ticket-print" id="ticket-imprimible" data-ancho="80">
        <div className="ticket-cab">
          <b>{kioscoNombre}</b>
          <span>RESUMEN DE LA CAJA · {z.estado === "cerrado" ? "Caja cerrada" : "Caja abierta (parcial)"}</span>
          <span>Apertura: {fecha(z.abierto_at)}</span>
          {z.cerrado_at && <span>Cierre: {fecha(z.cerrado_at)}</span>}
        </div>
        <div className="ticket-tot">
          <div className="ticket-linea"><span>Fondo inicial</span><span>{peso(z.monto_inicial)}</span></div>
          {MEDIOS.map((m) => (<div className="ticket-linea" key={m}><span>Cobros {ETIQUETA_MEDIO[m].toLowerCase()}</span><span>{peso(z.cobros_por_medio[m] ?? 0)}</span></div>))}
          <div className="ticket-linea"><span>Refuerzos</span><span>{peso(z.refuerzos)}</span></div>
          <div className="ticket-linea"><span>Plata que saqué</span><span>−{peso(z.sangrias_y_retiros)}</span></div>
        </div>
        <div className="ticket-pagos">
          <div className="ticket-linea ticket-total"><span>EFECTIVO ESPERADO</span><span>{peso(z.efectivo_esperado)}</span></div>
          {z.monto_declarado != null && <div className="ticket-linea"><span>Efectivo contado</span><span>{peso(z.monto_declarado)}</span></div>}
          {filaDif != null && <div className="ticket-linea"><span>Diferencia</span><span>{filaDif > 0 ? "+" : ""}{peso(filaDif)}</span></div>}
        </div>
        <div className="ticket-pagos">
          <div className="ticket-linea"><span>Ventas</span><span>{z.ventas}</span></div>
          <div className="ticket-linea"><span>Anuladas</span><span>{z.anuladas}</span></div>
          <div className="ticket-linea"><span>Descuentos</span><span>{peso(z.descuentos)}</span></div>
          {(z.descuentos_lineas ?? 0) > 0 && <div className="ticket-linea"><span>· por renglón</span><span>{peso(z.descuentos_lineas ?? 0)}</span></div>}
          {(z.descuentos_promos ?? 0) > 0 && <div className="ticket-linea"><span>· por promociones</span><span>{peso(z.descuentos_promos ?? 0)}</span></div>}
          {(z.descuentos - (z.descuentos_lineas ?? 0) - (z.descuentos_promos ?? 0)) > 0.004 && <div className="ticket-linea"><span>· global</span><span>{peso(z.descuentos - (z.descuentos_lineas ?? 0) - (z.descuentos_promos ?? 0))}</span></div>}
          <div className="ticket-linea ticket-total"><span>TOTAL VENDIDO</span><span>{peso(z.total_vendido)}</span></div>
          {(z.devoluciones ?? 0) > 0 && <div className="ticket-linea"><span>Devoluciones ({z.devoluciones})</span><span>−{peso(z.devoluciones_total ?? 0)}</span></div>}
          {(z.devoluciones ?? 0) > 0 && <div className="ticket-linea ticket-total"><span>TOTAL NETO</span><span>{peso(z.total_neto ?? z.total_vendido)}</span></div>}
        </div>
        <p className="ticket-gracias">La cuenta corriente no entra en la caja: queda anotada en Fiado.</p>
      </div>
      <button className="sec no-print" onClick={() => window.print()}>Imprimir resumen</button>
    </div>
  );
}
