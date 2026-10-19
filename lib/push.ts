// Lógica pura de los avisos push (sin Next ni Supabase, para poder probarla en Node).
export type PedidoAviso = { numero: number; cliente_nombre: string; total: number };

export function armarAvisoPedido(p: PedidoAviso) {
  const total = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(Math.round(Number(p.total)));
  return { title: `Nuevo pedido #${p.numero}`, body: `${p.cliente_nombre} · $${total}`, url: "/panel" };
}

// Una suscripción del navegador sirve si tiene un endpoint https y las dos claves.
export function suscripcionValida(s: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null | undefined): boolean {
  return !!s && typeof s.endpoint === "string" && s.endpoint.startsWith("https://")
    && typeof s.keys?.p256dh === "string" && s.keys.p256dh.length > 0
    && typeof s.keys?.auth === "string" && s.keys.auth.length > 0;
}

// Aviso al dueño según lo que resolvió la base al aplicar un pago de Mercado Pago. null = no hay nada que avisar.
export function armarAvisoPago(resultado: string | null, p: { numero: number; cliente_nombre: string; total: number }) {
  const total = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(Math.round(Number(p.total)));
  switch (resultado) {
    case "confirmado": return { title: `Pedido #${p.numero} pagado`, body: `${p.cliente_nombre} · $${total} · Mercado Pago`, url: "/panel" };
    case "cancelado_con_pago": return { title: `Pedido #${p.numero} cobrado pero cancelado`, body: "Reembolsalo desde tu cuenta de Mercado Pago.", url: "/panel" };
    case "pago_duplicado": return { title: `Pedido #${p.numero} cobrado dos veces`, body: "Reembolsá el pago de más desde tu cuenta de Mercado Pago.", url: "/panel" };
    case "pagado_sin_stock": return { title: `Pedido #${p.numero} pagado, sin stock`, body: "El cliente ya pagó pero falta mercadería. Revisalo.", url: "/panel" };
    case "monto_invalido": return { title: `Pedido #${p.numero}: pago con otro monto`, body: "El pago no coincide con el total. Revisalo en Mercado Pago.", url: "/panel" };
    default: return null;
  }
}

// Aviso al dueño por un cobro QR del mostrador. Lo normal (cobro confirmado) no avisa: la caja lo muestra en pantalla.
export function armarAvisoQR(resultado: string | null, monto: number) {
  const m = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(Math.round(Number(monto)));
  switch (resultado) {
    case "aprobado_tarde": return { title: `Cobro QR de $${m} llegó tarde`, body: "El cliente pagó cuando el cobro ya había vencido. Revisá la caja: la plata entró.", url: "/panel" };
    case "monto_invalido": return { title: `Cobro QR de $${m}: pago con otro monto`, body: "El pago no coincide con el cobro. Revisalo en Mercado Pago.", url: "/panel" };
    case "reembolsado_con_venta": return { title: `Cobro QR de $${m} reembolsado`, body: "Esa venta ya estaba registrada en la caja. Revisala.", url: "/panel" };
    default: return null;
  }
}
