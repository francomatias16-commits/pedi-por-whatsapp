"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { mensajeErrorSql } from "@/lib/errores";
import { PROVINCIAS, QR_MINUTOS, QR_MONTO_MIN, validarUbicacion } from "@/lib/pagos/qr";
import { llamarQR } from "@/lib/pagos/qr-cliente";
import Aviso from "@/components/ui/Aviso";
import { peso } from "@/lib/whatsapp";

type Config = { configurado: boolean; cuenta_distinta?: boolean; activo: boolean; conexion: boolean; qr_imagen?: string | null; qr_plantilla?: string | null };
const ERRORES: Record<string, string> = {
  no_autorizado: "Tu sesión venció. Volvé a entrar al panel.",
  sin_conexion: "Primero conectá Mercado Pago (arriba).",
  token_rechazado: "Mercado Pago rechazó tu credencial. Cargala de nuevo arriba.",
  mp_rechazo_datos: "Mercado Pago no aceptó la dirección. Revisá la calle, el número, la ciudad y la ubicación en el mapa.",
  mp_sin_qr: "Mercado Pago creó la caja pero no devolvió el QR. Probá de nuevo en un momento.",
  mp_no_responde: "Mercado Pago no responde ahora. Probá de nuevo en un momento.",
  calle_invalida: "Escribí la calle.", numero_invalido: "Escribí el número.", ciudad_invalida: "Escribí la ciudad.", provincia_invalida: "Elegí la provincia.",
  coordenadas_invalidas: "La ubicación no es válida. Tiene que estar dentro de Argentina: usá el botón \"Usar mi ubicación actual\" estando en el local.",
  db: "No se pudo guardar. Probá de nuevo.",
};

// Cobrar con QR en la caja: alta única (sucursal y caja en Mercado Pago), QR para imprimir e interruptor. Solo el dueño la ve (está en Mi negocio).
export default function CobroQR({ kiosco, onCambio }: { kiosco: Kiosco; onCambio: () => void }) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error" | "alerta"; texto: string } | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [f, setF] = useState({ calle: "", numero: "", ciudad: "", provincia: "Santa Fe", lat: "", lng: "" });

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc("qr_estado_config", { p_kiosco: kiosco.id });
    if (error) { setMsg({ tipo: "error", texto: mensajeErrorSql(error.message) }); return; }
    setCfg(data as Config);
  }, [kiosco.id]);
  useEffect(() => { void cargar(); }, [cargar]);

  const usarUbicacion = () => {
    setMsg(null);
    if (!navigator.geolocation) { setMsg({ tipo: "alerta", texto: "Este navegador no puede darnos tu ubicación. Cargá la latitud y la longitud a mano." }); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => setF((x) => ({ ...x, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) })),
      () => setMsg({ tipo: "alerta", texto: "No pudimos leer tu ubicación. Aceptá el permiso del navegador o cargala a mano." }),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const datos = { calle: f.calle, numero: f.numero, ciudad: f.ciudad, provincia: f.provincia, lat: Number(f.lat.replace(",", ".")), lng: Number(f.lng.replace(",", ".")) };
  const invalido = validarUbicacion(datos);

  async function crear() {
    setMsg(null);
    if (invalido) { setMsg({ tipo: "error", texto: ERRORES[invalido] ?? "Revisá los datos." }); return; }
    setTrabajando(true);
    const r = await llamarQR("/api/pagos/mp/qr/alta", { kiosco: kiosco.id, ...datos });
    setTrabajando(false);
    if (!r.ok) { setMsg({ tipo: "error", texto: ERRORES[String(r.j.error)] ?? "No se pudo crear el QR. Probá de nuevo." }); return; }
    setMsg({ tipo: "ok", texto: "Listo. Tu QR está creado. Imprimilo y pegalo en el mostrador; después activá el cobro con QR en la caja." });
    await cargar(); onCambio();
  }

  async function encender(v: boolean) {
    setTrabajando(true); setMsg(null);
    const { error } = await supabase.rpc("qr_configurar_activo", { p_kiosco: kiosco.id, p_activo: v });
    setTrabajando(false);
    if (error) { setMsg({ tipo: "error", texto: mensajeErrorSql(error.message) }); return; }
    await cargar(); onCambio();
  }

  if (!cfg) return msg ? <Aviso tipo={msg.tipo}>{msg.texto}</Aviso> : <p role="status" className="mut">Cargando…</p>;
  if (!cfg.conexion) return <p className="mut">Para cobrar con QR en la caja, primero conectá Mercado Pago.</p>;

  return (
    <div>
      <p className="mut">En la caja, el cajero carga el monto y el cliente escanea el QR fijo de tu local con la app de Mercado Pago. La venta se anota sola cuando el pago se aprueba. Mínimo {peso(QR_MONTO_MIN)} por cobro; si el cliente no paga en {QR_MINUTOS} minutos, el cobro vence. El QR atiende un cobro a la vez.</p>

      {cfg.cuenta_distinta && <Aviso tipo="alerta">Conectaste otra cuenta de Mercado Pago después de crear el QR. Creá el QR de nuevo con la cuenta actual.</Aviso>}

      {cfg.configurado ? (
        <div className="card" role="group" aria-label="QR del mostrador">
          {cfg.qr_imagen && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cfg.qr_imagen} alt="QR de Mercado Pago de tu local" width={220} height={220} style={{ background: "#fff", padding: 8, border: "1px solid var(--line)" }} />
              <p><a href={cfg.qr_plantilla ?? cfg.qr_imagen} target="_blank" rel="noopener noreferrer">Abrir para imprimir</a></p>
            </>
          )}
          <label>
            <input type="checkbox" checked={cfg.activo} disabled={trabajando} onChange={(e) => encender(e.target.checked)} style={{ width: "auto", marginRight: 8 }} />
            Cobrar con QR en la caja
          </label>
          {cfg.activo && <p className="mut">Con esto encendido, una venta cobrada con &quot;QR / Mercado Pago&quot; solo se registra si el pago está aprobado. Para transferencias comunes usá el medio &quot;Transferencia&quot;.</p>}
        </div>
      ) : (
        <>
          <h3>Crear el QR del local</h3>
          <p className="mut">Mercado Pago necesita la dirección del local para crear la sucursal y la caja. Se hace una sola vez.</p>
          <label>Calle<input value={f.calle} onChange={(e) => setF({ ...f, calle: e.target.value })} autoComplete="street-address" /></label>
          <label>Número<input value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} inputMode="numeric" /></label>
          <label>Ciudad<input value={f.ciudad} onChange={(e) => setF({ ...f, ciudad: e.target.value })} /></label>
          <label>Provincia
            <select value={f.provincia} onChange={(e) => setF({ ...f, provincia: e.target.value })}>{PROVINCIAS.map((p) => <option key={p}>{p}</option>)}</select>
          </label>
          <p className="mut">Ubicación exacta del local. Lo más fácil: estando en el local, tocá el botón.</p>
          <button type="button" className="sec" onClick={usarUbicacion} disabled={trabajando}>Usar mi ubicación actual</button>
          <label>Latitud<input value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} inputMode="decimal" placeholder="-29.150000" /></label>
          <label>Longitud<input value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} inputMode="decimal" placeholder="-59.650000" /></label>
          <button type="button" className="principal" onClick={crear} disabled={trabajando || !!invalido}>{trabajando ? "Creando…" : "Crear mi QR"}</button>
        </>
      )}
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      <p className="mut">Para que la caja se entere del pago al instante, en los Webhooks de tu aplicación de Mercado Pago tiene que estar elegido el evento <b>Order (Mercado Pago)</b>. Si no, la caja igual lo detecta, pero con unos segundos de demora.</p>
      <p className="mut">Si un cliente pide la plata de vuelta, la devolución se hace desde tu cuenta de Mercado Pago. Anular la venta en la caja no devuelve el pago.</p>
    </div>
  );
}
