"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

// Código QR de la tienda: vive en "Mi local" (antes aparecía arriba de todas las pantallas).
export default function QrKiosco({ slug, nombre }: { slug: string; nombre: string }) {
  const [png, setPng] = useState("");
  const [copiado, setCopiado] = useState(false);
  const url = typeof window !== "undefined" ? `${location.origin}/${slug}` : "";

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
        <b>Tu tienda para compartir</b>
        <p className="mut" style={{ margin: ".15rem 0 .5rem" }}>Pegá el QR en la vidriera, el mostrador y las bolsas.</p>
        <p className="mut qr-url">{url}</p>
        <div className="qr-acciones">
          <a className="btn" download={`qr-${slug}.png`} href={png}>Descargar QR</a>
          <button type="button" className="sec" onClick={copiar}>{copiado ? "Link copiado" : "Copiar link"}</button>
        </div>
      </div>
    </div>
  );
}
