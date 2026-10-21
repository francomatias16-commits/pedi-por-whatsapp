import type { Tab } from "@/lib/navegacion";

// Guía corta de cada pantalla: qué es y qué hacer primero. Se ve con el botón "¿Cómo se usa?".
export const GUIAS: Record<Tab, { titulo: string; texto: string }> = {
  resumen: { titulo: "Inicio", texto: "Acá ves qué tenés que hacer hoy. Lo urgente va arriba. Si no hay nada urgente, te lo dice." },
  caja: { titulo: "Vender", texto: "Cargá los productos que compra el cliente, tocá Cobrar y elegí cómo paga. Para empezar el día, abrí la caja con la plata que tenés." },
  pedidos: { titulo: "Pedidos", texto: "Acá llegan los pedidos de tus clientes. Tocá Confirmar cuando puedas prepararlo y Avisar por WhatsApp para contarle." },
  productos: { titulo: "Productos", texto: "Acá cargás lo que vendés, con su precio. Podés marcar si se acabó tocando el botón del producto." },
  precios: { titulo: "Cambiar precios", texto: "Subí o bajá varios precios juntos. Mirá primero cómo queda: nada cambia hasta que toques Aplicar." },
  etiquetas: { titulo: "Carteles de precio", texto: "Elegí los productos y generá carteles para imprimir y poner en el estante." },
  conteo: { titulo: "Contar mercadería", texto: "Contá lo que hay en el estante y guardá lo contado. Las ventas siguen mientras contás." },
  fiado: { titulo: "Quién me debe", texto: "Acá ves lo que te deben tus clientes. Para anotar algo nuevo, tocá el nombre y poné el monto." },
  sellos: { titulo: "Puntos y premios", texto: "Armá cómo tus clientes juntan puntos y qué premio se llevan. El asistente de 3 pasos te guía." },
  radar: { titulo: "Alertas del negocio", texto: "Acá aparecen clientes que dejaron de venir y mercadería que vence. Tocá una alerta para actuar." },
  reponer: { titulo: "Qué comprar", texto: "Lo que se acabó o queda poco, con cuánto pedir a cada proveedor. Tocá Pedir por WhatsApp." },
  proveedores: { titulo: "Proveedores", texto: "Cargá a tus proveedores con su WhatsApp y registrá las compras que hacés." },
  local: { titulo: "Mi negocio", texto: "Datos de tu local, horarios, cómo cobrás y el QR para compartir. Tocá cada parte para abrirla." },
};
