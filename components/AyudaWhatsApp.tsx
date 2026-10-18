import { hayAyuda, linkAyuda } from "@/lib/ayuda";

// "¿Necesitás ayuda?" → abre WhatsApp con el contacto de soporte. No se muestra si no hay número configurado.
export default function AyudaWhatsApp({ texto = "¿Necesitás ayuda? Escribinos por WhatsApp", mensaje }: { texto?: string; mensaje?: string }) {
  if (!hayAyuda) return null;
  return <a className="ayuda-wa" href={linkAyuda(mensaje)} target="_blank" rel="noopener noreferrer">{texto}</a>;
}
