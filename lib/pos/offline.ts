// Cola de ventas hechas sin conexión. Cada venta lleva un offline_id: si el envío se corta a mitad de camino y se
// reintenta, el servidor devuelve la misma venta en vez de duplicarla.
export interface Almacen { getItem(k: string): string | null; setItem(k: string, v: string): void }

export type VentaPendiente = {
  offline_id: string; turno_id: string; fecha: string; items: { producto_id: string; cantidad: number; descuento_pct: number }[];
  pagos: { medio: string; monto: number }[]; cliente_id: string | null; descuento_pct: number; total: number; intentos: number;
};
export type VentaRechazada = VentaPendiente & { motivo: string };
export type Envio = { ok: true } | { ok: false; definitivo: boolean; mensaje: string };

export class ColaVentas {
  constructor(private alm: Almacen, private clave: string) {}
  private leer<T>(sufijo: string): T[] { try { return JSON.parse(this.alm.getItem(this.clave + sufijo) ?? "[]") as T[]; } catch { return []; } }
  private escribir(sufijo: string, v: unknown[]) { this.alm.setItem(this.clave + sufijo, JSON.stringify(v)); }
  pendientes() { return this.leer<VentaPendiente>(":p"); }
  rechazadas() { return this.leer<VentaRechazada>(":r"); }
  encolar(v: Omit<VentaPendiente, "intentos">) {
    const p = this.pendientes();
    if (p.some((x) => x.offline_id === v.offline_id)) return;
    this.escribir(":p", [...p, { ...v, intentos: 0 }]);
  }
  descartarRechazada(id: string) { this.escribir(":r", this.rechazadas().filter((x) => x.offline_id !== id)); }
  /** Reserva de stock local: cuánto de cada producto está vendido pero todavía no sincronizado. */
  reservado(): Record<string, number> {
    const r: Record<string, number> = {};
    for (const v of this.pendientes()) for (const i of v.items) r[i.producto_id] = (r[i.producto_id] ?? 0) + i.cantidad;
    return r;
  }
  /** Envía en orden. Un fallo de red corta (se reintenta luego); un rechazo del servidor aparta esa venta y sigue. */
  async sincronizar(enviar: (v: VentaPendiente) => Promise<Envio>) {
    let enviadas = 0, rechazadas = 0;
    for (const v of this.pendientes()) {
      const r = await enviar(v);
      const actuales = this.pendientes().filter((x) => x.offline_id !== v.offline_id);
      if (r.ok) { this.escribir(":p", actuales); enviadas++; continue; }
      if (r.definitivo) {
        this.escribir(":p", actuales);
        this.escribir(":r", [...this.rechazadas(), { ...v, intentos: v.intentos + 1, motivo: r.mensaje }]);
        rechazadas++; continue;
      }
      this.escribir(":p", this.pendientes().map((x) => (x.offline_id === v.offline_id ? { ...x, intentos: x.intentos + 1 } : x)));
      break;
    }
    return { enviadas, rechazadas, pendientes: this.pendientes().length };
  }
}
