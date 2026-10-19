"use client";
import { useEffect, useState } from "react";

// Instalar la app en el celular o la computadora.
// - Chrome, Edge y Android: el navegador avisa por su cuenta; el botón abre ese aviso.
// - iPhone y iPad (Safari): no hay aviso; el botón muestra los pasos para agregarla a la pantalla de inicio.
// - Si ya está instalada, o el navegador no permite instalar, no aparece nada.

type EventoInstalar = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

// El aviso del navegador llega una sola vez: se guarda al llegar, aunque el botón todavía no esté montado.
let evento: EventoInstalar | null = null;
const suscriptos = new Set<() => void>();
const avisarTodos = () => suscriptos.forEach((f) => f());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); evento = e as EventoInstalar; avisarTodos(); });
  window.addEventListener("appinstalled", () => { evento = null; avisarTodos(); });
}

const esIphone = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
const yaInstalada = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

export default function InstalarApp({ block = false }: { block?: boolean }) {
  const [, actualizar] = useState(0);
  const [ios, setIos] = useState(false);
  const [instalada, setInstalada] = useState(false);
  const [pasos, setPasos] = useState(false);
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    const cambio = () => actualizar((n) => n + 1);
    suscriptos.add(cambio);
    setIos(esIphone());
    setInstalada(yaInstalada());
    setMontado(true);
    return () => { suscriptos.delete(cambio); };
  }, []);

  // Antes de montar no se dibuja nada: así el servidor y el navegador muestran lo mismo.
  if (!montado || instalada || (!evento && !ios)) return null;

  const instalar = async () => {
    if (!evento) { setPasos((p) => !p); return; }
    const aviso = evento;
    evento = null;
    avisarTodos();
    await aviso.prompt();
    await aviso.userChoice;
  };

  return (
    <>
      <button type="button" className="sec" onClick={instalar} style={block ? { width: "100%", marginBottom: 8 } : undefined} aria-expanded={!evento ? pasos : undefined}>
        Instalar la app
      </button>
      {!evento && pasos && (
        <p className="mut" role="status" style={{ margin: "0 0 10px" }}>
          Tocá el botón <b>Compartir</b> de Safari (el cuadrado con una flecha hacia arriba) y elegí <b>«Agregar a pantalla de inicio»</b>.
        </p>
      )}
    </>
  );
}
