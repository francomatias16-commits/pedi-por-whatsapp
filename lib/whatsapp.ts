/** Normaliza un teléfono argentino a formato wa.me: 54 9 + área + número (sin 0 ni 15). */
export function normalizarTelefonoAR(input: string): string {
  let d = input.replace(/\D/g, "");
  if (d.startsWith("549")) return d;
  if (d.startsWith("54")) d = d.slice(2);
  d = d.replace(/^0+/, "");
  if (d.length === 12) {
    for (const a of [2, 3, 4]) {
      if (d.slice(a, a + 2) === "15") { d = d.slice(0, a) + d.slice(a + 2); break; }
    }
  }
  return "549" + d;
}

export const ETIQUETA_PAGO: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", mercadopago: "Mercado Pago" };

// Enteros sin decimales ($ 1.500); si hay centavos se muestran ($ 332,67): una venta por peso o una devolución prorrateada no puede verse redondeada.
export const peso = (n: number) => {
  const dec = Number.isInteger(n) ? 0 : 2;
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
};

export function linkWhatsApp(telefonoIntl: string, texto: string) {
  return `https://wa.me/${telefonoIntl}?text=${encodeURIComponent(texto)}`;
}

export function mensajePedido(p: {
  numero?: number; nombre: string; telefono: string; modalidad: "retiro" | "envio";
  direccion?: string; costoEnvio?: number; medioPago?: string; items: { nombre: string; cantidad: number; precio: number }[]; total: number; notas?: string;
}) {
  const lineas = p.items.map((i) => `• ${i.cantidad} x ${i.nombre} — ${peso(i.precio * i.cantidad)}`);
  return [
    `Hola! Quiero hacer un pedido${p.numero ? ` (#${p.numero})` : ""}:`,
    ...lineas,
    p.costoEnvio ? `Envío: ${peso(p.costoEnvio)}` : "",
    `Total: ${peso(p.total)}`,
    p.medioPago ? `Pago: ${ETIQUETA_PAGO[p.medioPago] ?? p.medioPago}` : "",
    p.modalidad === "envio" ? `Envío a: ${p.direccion}` : "Retiro en el local",
    p.notas ? `Nota: ${p.notas}` : "",
    `Nombre: ${p.nombre}`,
    `Tel: ${p.telefono}`,
  ].filter(Boolean).join("\n");
}
