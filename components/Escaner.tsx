"use client";
import { useEffect, useRef, useState } from "react";

export default function Escaner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cb = useRef(onCode);
  cb.current = onCode;
  const [err, setErr] = useState("");

  useEffect(() => {
    let stopped = false;
    let controls: { stop: () => void } | undefined;
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const { DecodeHintType, BarcodeFormat } = await import("@zxing/library");
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128]);
        const reader = new BrowserMultiFormatReader(hints);
        controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, videoRef.current!, (result) => {
          if (result && !stopped) {
            stopped = true;
            controls?.stop();
            if (navigator.vibrate) navigator.vibrate(60);
            cb.current(result.getText());
          }
        });
        if (stopped) controls.stop();
      } catch {
        setErr("No pude abrir la cámara. Revisá el permiso del navegador o cargá el código a mano.");
      }
    })();
    return () => { stopped = true; controls?.stop(); };
  }, []);

  return (
    <div className="card">
      <video ref={videoRef} muted playsInline style={{ width: "100%", borderRadius: 10, background: "#000" }} />
      {err && <p role="alert" style={{ color: "var(--danger)" }}>{err}</p>}
      <p className="mut">Apuntá al código de barras del producto.</p>
      <button className="sec" onClick={onClose}>Cerrar cámara</button>
    </div>
  );
}
