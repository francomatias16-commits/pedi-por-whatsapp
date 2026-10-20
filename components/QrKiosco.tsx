"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { linkQrUnico } from "@/lib/club";

// QR único del local: lleva al club de sellos y, desde ahí, al catálogo (si el local tiene tienda). Si el club está apagado, lleva directo a la tienda.
export default function QrKiosco({ slug, nombre, clubActivo = true, tiendaActiva = true }: { slug: string; nombre: string; clubActivo?: boolean; tiendaActiva?: boolean }) {
  const [png, setPng] = useState("");
  const [copiado, setCopiado] = useState(false);
  const url = typeof window !== "undefined" ? linkQrUnico({ slug, club_activo: clubActivo }, location.origin) : "";

  useEffect(() => {
    if (!url) return;
    QRCode.toDataURL(url, { width: 1024, margin: 2, errorCorrectionLevel: "M" }).then(setPng);
  }, [url]);

  async function copiar() {
    try { await navigator.clipboard.writeText(url); setCopiado(true); setTimeout(() => setCopiado(false), 2500); } catch { setCopiado(false); }
  }

  if (!png) return null;
  return (
    <div className="card qr-card">
      <img src={png} alt={`QR de ${nombre}`} width={96} height={96} />
      <div className="qr-datos">
        <b>Tu QR para compartir</b>
        <p className="mut" style={{ margin: ".15rem 0 .5rem" }}>{clubActivo && tiendaActiva ? "Un solo QR: tarjeta de sellos y catálogo." : clubActivo ? "Lleva a la tarjeta de sellos (la tienda online está apagada)." : "Lleva directo a la tienda (el club está en pausa)."} Pegalo en la vidriera, el mostrador y las bolsas.</p>
        <p className="mut qr-url">{url}</p>
        <div className="qr-acciones">
          <a className="btn" download={`qr-${slug}.png`} href={png}>Descargar QR</a>
          <button type="button" className="sec" onClick={copiar}>{copiado ? "Link copiado" : "Copiar link"}</button>
        </div>
      </div>
    </div>
  );
}
