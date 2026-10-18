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
