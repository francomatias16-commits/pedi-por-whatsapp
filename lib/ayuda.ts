// Contacto de ayuda por WhatsApp. Se configura con NEXT_PUBLIC_WHATSAPP_AYUDA (solo dígitos, con código de país, ej: 5491155555555).
// Si no está configurado, el enlace de ayuda no se muestra.
const NUMERO = (process.env.NEXT_PUBLIC_WHATSAPP_AYUDA ?? "").replace(/\D/g, "");

export const hayAyuda = NUMERO.length >= 10;
export const linkAyuda = (mensaje = "Hola, necesito ayuda con Pedí por WhatsApp") =>
  hayAyuda ? `https://wa.me/${NUMERO}?text=${encodeURIComponent(mensaje)}` : "";
