// Limpieza de eventos antes de mandarlos a Sentry: no deben salir teléfonos, direcciones ni cuerpos de pedidos.
// Lógica pura (sin importar Sentry) para probarla con `npm test`.
type Evento = { request?: { data?: unknown; cookies?: unknown; headers?: Record<string, string>; query_string?: unknown }; user?: unknown };

const TEL = /\b(?:\+?54)?\s?9?\s?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{4}\b/g;

export function limpiarTexto(s: string): string {
  return s.replace(TEL, "[tel]");
}

export function limpiarEvento<T extends Evento>(ev: T): T {
  if (ev.request) {
    delete ev.request.data;
    delete ev.request.cookies;
    delete ev.request.query_string;
    if (ev.request.headers) {
      for (const k of Object.keys(ev.request.headers)) if (/^(authorization|cookie|x-.*(secret|signature|token).*)$/i.test(k)) delete ev.request.headers[k];
    }
  }
  delete ev.user;
  return JSON.parse(JSON.stringify(ev), (_k, v) => (typeof v === "string" ? limpiarTexto(v) : v));
}
