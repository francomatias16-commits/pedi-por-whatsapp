"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { EstadoVinculo } from "./useVinculoCelular";

// Ventana del QR para usar el celular como lector de códigos de barras. "Ocultar" no corta el vínculo.
export default function VincularCelular({ estado, url, error, ultimo, onCerrarVinculo, onOcultar }: {
  estado: EstadoVinculo; url: string; error: string; ultimo: string; onCerrarVinculo: () => void; onOcultar: () => void;
}) {
  const [png, setPng] = useState("");
  useEffect(() => { if (url) QRCode.toDataURL(url, { width: 280, margin: 1, errorCorrectionLevel: "M" }).then(setPng); else setPng(""); }, [url]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onOcultar(); } };
    window.addEventListener("keydown", h, true); return () => window.removeEventListener("keydown", h, true);
  }, [onOcultar]);
  return (
    <div className="pos-overlay" role="dialog" aria-modal="true" aria-label="Vincular celular">
      <div className="pos-modal" style={{ maxWidth: 420, textAlign: "center" }}>
        <div className="pos-modal-head"><h2>Celular como lector</h2></div>
        {error && <p className="pos-error" role="alert">{error}</p>}
        {estado === "inactivo" ? <p className="mut">Generando vínculo…</p> : (
          <>
            {estado === "conectado"
              ? <p className="pos-aviso" role="status">Celular conectado. Apuntá al código de barras y se suma solo al ticket.</p>
              : <p className="mut">Escaneá este QR con la cámara del celular (tiene que tener internet).</p>}
            {png && estado === "esperando" && <img src={png} alt="QR para vincular el celular" width={240} height={240} style={{ margin: ".5rem auto" }} />}
            {ultimo && <p className="mut">Último código: <b className="mono">{ultimo}</b></p>}
            <p className="mut" style={{ fontSize: ".82rem" }}>El link es privado: no lo compartas. Se corta al cerrar el vínculo o tras 45 minutos sin escanear.</p>
          </>
        )}
        <div className="pos-modal-acciones">
          {estado !== "inactivo" && <button className="sec peligro" onClick={onCerrarVinculo}>Cerrar vínculo</button>}
          <button onClick={onOcultar}>{estado === "conectado" ? "Seguir vendiendo" : "Ocultar"} <kbd>Esc</kbd></button>
        </div>
      </div>
    </div>
  );
}
