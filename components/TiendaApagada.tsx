import Link from "next/link";
import { linkWhatsApp, normalizarTelefonoAR } from "@/lib/whatsapp";

// El local no tiene tienda online (la apagó en Mi negocio). Se muestra esto en vez de un catálogo vacío.
// Si el club de sellos está activo, el cliente igual puede ir a su tarjeta.
export default function TiendaApagada({ nombre, slug, whatsapp, hayClub }: { nombre: string; slug: string; whatsapp: string; hayClub: boolean }) {
  return (
    <main className="club">
      <p className="mut">{nombre}</p>
      <h1>Este local no recibe pedidos online</h1>
      <p>Pasá por el local o escribile por WhatsApp.</p>
      <a className="btn" href={linkWhatsApp(normalizarTelefonoAR(whatsapp), `Hola! Vi el QR de ${nombre}. ¿Me pueden ayudar con un pedido?`)}>Escribir por WhatsApp</a>
      {hayClub && <p><Link href={`/${slug}/club`}>Ver mi tarjeta de sellos</Link></p>}
    </main>
  );
}
