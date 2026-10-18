"use client";
import { useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { mensajeError, type PosConfig } from "@/lib/caja";
import { paginaDePrueba, pulsoCajon } from "@/lib/pos/escpos";
import { alCambiarImpresora, conectarSerie, conectarUsb, desconectarImpresora, enviarAImpresora, impresoraConectada, mensajeImpresora, soporte } from "@/lib/pos/impresora";
import { usePin } from "./PinModal";

// Configuración del POS: ticket, impresora térmica, cajón, sonido y PIN de supervisor.
export default function ConfigPos({ kiosco, config, onCambio }: { kiosco: Kiosco; config: PosConfig; onCambio: () => void }) {
  const [enc, setEnc] = useState(config.ticket_encabezado ?? "");
  const [pie, setPie] = useState(config.ticket_pie ?? "");
  const [ancho, setAncho] = useState<58 | 80>(config.ticket_ancho);
  const [auto, setAuto] = useState(config.imprimir_auto);
  const [cajon, setCajon] = useState(config.abrir_cajon);
  const [sonido, setSonido] = useState(config.sonido);
  const [pinAnular, setPinAnular] = useState(config.pin_anular);
  const [pinDev, setPinDev] = useState(config.pin_devolucion);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [impresora, setImpresora] = useState(impresoraConectada());
  const [errImp, setErrImp] = useState("");
  const [pin1, setPin1] = useState(""); const [pin2, setPin2] = useState("");
  const [cambiando, setCambiando] = useState(false);
  const { pedir, modal } = usePin(kiosco.id);
  const sop = soporte();

  useEffect(() => alCambiarImpresora(() => setImpresora(impresoraConectada())), []);

  const ok = (m: string) => { setMsg(m); setErr(""); setTimeout(() => setMsg(""), 4000); };
  const fallo = (m: string) => { setErr(m); setMsg(""); };

  async function guardar() {
    setOcupado(true); setErr("");
    const vals = { ticket_encabezado: enc.trim() || null, ticket_pie: pie.trim() || null, ticket_ancho: ancho, imprimir_auto: auto, abrir_cajon: cajon, sonido };
    const up = await supabase.from("pos_config").update({ ...vals, updated_at: new Date().toISOString() }).eq("kiosco_id", kiosco.id).select("kiosco_id");
    let e = up.error;
    if (!e && !(up.data ?? []).length) e = (await supabase.from("pos_config").insert({ kiosco_id: kiosco.id, ...vals })).error;
    setOcupado(false);
    if (e) return fallo("No se pudo guardar la configuración.");
    onCambio(); ok("Configuración guardada.");
  }

  // Exigir PIN al anular/devolver se cambia por función: apagar la exigencia con PIN puesto pide el PIN.
  async function guardarOpcionesPin() {
    setErr("");
    const aflojar = config.tiene_pin && ((config.pin_anular && !pinAnular) || (config.pin_devolucion && !pinDev));
    let token: string | null = null;
    if (aflojar) { const t = await pedir("Para dejar de exigir el PIN hace falta el PIN actual."); if (t === undefined) return; token = t; }
    setOcupado(true);
    const { error } = await supabase.rpc("pos_pin_opciones", { p_kiosco: kiosco.id, p_anular: pinAnular, p_devolucion: pinDev, p_token: token });
    setOcupado(false);
    if (error) return fallo(error.message.includes("pin_requerido") ? "El PIN venció (dura 2 minutos). Probá de nuevo." : "No se pudo guardar. ¿Aplicaste la migración 0014?");
    onCambio(); ok("Opciones del PIN guardadas.");
  }

  async function definirPin() {
    setErr("");
    if (!/^\d{4,8}$/.test(pin1)) return fallo("El PIN tiene que ser de 4 a 8 números.");
    if (pin1 !== pin2) return fallo("Los dos PIN no coinciden.");
    let token: string | null = null;
    if (config.tiene_pin) { const t = await pedir("Ingresá el PIN actual para cambiarlo."); if (t === undefined) return; token = t; }
    setOcupado(true);
    const { error } = await supabase.rpc("pos_pin_definir", { p_kiosco: kiosco.id, p_pin: pin1, p_token: token });
    setOcupado(false);
    if (error) return fallo(error.message.includes("pin_requerido") ? "El PIN venció (dura 2 minutos). Probá de nuevo." : mensajeError(error.message));
    setPin1(""); setPin2(""); setCambiando(false); onCambio(); ok(config.tiene_pin ? "PIN cambiado." : "PIN definido. Desde ahora se pide para anular y devolver.");
  }
  async function quitarPin() {
    const t = await pedir("Ingresá el PIN actual para quitarlo."); if (t === undefined || t === null) return;
    setOcupado(true);
    const { error } = await supabase.rpc("pos_pin_quitar", { p_kiosco: kiosco.id, p_token: t });
    setOcupado(false);
    if (error) return fallo("No se pudo quitar el PIN.");
    onCambio(); ok("PIN quitado: anular y devolver ya no lo piden.");
  }

  async function conectar(tipo: "usb" | "serie") {
    setErrImp("");
    try { await (tipo === "usb" ? conectarUsb() : conectarSerie()); } catch (e) { setErrImp(mensajeImpresora(e)); }
  }
  async function probar(conCajon: boolean) {
    setErrImp("");
    const okEnvio = await enviarAImpresora(conCajon ? pulsoCajon() : paginaDePrueba(ancho, false));
    if (!okEnvio) setErrImp("No se pudo enviar a la impresora. Reconectala.");
  }

  return (
    <div>
      {msg && <p className="pos-aviso" role="status">{msg}</p>}
      {err && <p className="pos-error" role="alert">{err}</p>}

      <div className="card">
        <h3 className="pos-sub" style={{ marginTop: 0 }}>Ticket</h3>
        <label>Encabezado (dirección, teléfono, CUIT…)<textarea rows={2} maxLength={200} value={enc} onChange={(e) => setEnc(e.target.value)} /></label>
        <label>Pie del ticket<textarea rows={2} maxLength={200} value={pie} onChange={(e) => setPie(e.target.value)} placeholder="¡Gracias por su compra!" /></label>
        <label>Ancho del papel
          <select value={ancho} onChange={(e) => setAncho(Number(e.target.value) as 58 | 80)}><option value={58}>58 mm</option><option value={80}>80 mm</option></select>
        </label>
        <label style={{ display: "flex", gap: ".5rem", alignItems: "center" }}><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Imprimir el ticket automáticamente al cobrar</label>
        <label style={{ display: "flex", gap: ".5rem", alignItems: "center" }}><input type="checkbox" checked={cajon} onChange={(e) => setCajon(e.target.checked)} /> Abrir el cajón de dinero en las ventas con efectivo</label>
        <label style={{ display: "flex", gap: ".5rem", alignItems: "center" }}><input type="checkbox" checked={sonido} onChange={(e) => setSonido(e.target.checked)} /> Sonidos del POS (producto agregado, error, venta cobrada)</label>
        <div className="pos-modal-acciones"><button disabled={ocupado} onClick={guardar}>{ocupado ? "Guardando…" : "Guardar configuración"}</button></div>
      </div>

      <div className="card" style={{ marginTop: ".8rem" }}>
        <h3 className="pos-sub" style={{ marginTop: 0 }}>Impresora térmica y cajón</h3>
        {impresora ? <p className="pos-aviso" role="status">Conectada: {impresora.nombre} ({impresora.tipo === "usb" ? "USB" : "puerto serie"})</p>
          : <p className="mut">Sin impresora conectada: el ticket se imprime con el diálogo normal del navegador. {config.abrir_cajon ? "El cajón solo se abre solo con una impresora conectada acá (o si el driver de tu impresora lo abre al imprimir)." : ""}</p>}
        {errImp && <p className="pos-error" role="alert">{errImp}</p>}
        <div className="pos-venta-acc">
          {!impresora && sop.usb && <button className="sec" onClick={() => conectar("usb")}>Conectar por USB</button>}
          {!impresora && sop.serial && <button className="sec" onClick={() => conectar("serie")}>Conectar por puerto serie / Bluetooth</button>}
          {impresora && <button className="sec" onClick={() => probar(false)}>Imprimir prueba</button>}
          {impresora && <button className="sec" onClick={() => probar(true)}>Abrir cajón (prueba)</button>}
          {impresora && <button className="sec" onClick={() => void desconectarImpresora()}>Desconectar</button>}
        </div>
        {!sop.usb && !sop.serial && <p className="mut">Este navegador no permite conectar la impresora directo. Usá Chrome o Edge en la computadora.</p>}
        <p className="mut" style={{ fontSize: ".85rem" }}>La conexión directa funciona con impresoras ESC/POS (la gran mayoría de las de ticket). En Windows, por USB puede hacer falta cambiar el driver a WinUSB (herramienta Zadig) o conectarla como puerto COM.</p>
      </div>

      <div className="card" style={{ marginTop: ".8rem" }}>
        <h3 className="pos-sub" style={{ marginTop: 0 }}>PIN de supervisor</h3>
        <p className="mut">{config.tiene_pin ? "Hay un PIN activo." : "Sin PIN: cualquiera con la caja abierta puede anular y devolver."} Con PIN, esas acciones piden la clave; después de 5 intentos fallidos se bloquea 10 minutos.</p>
        {(!config.tiene_pin || cambiando) && (
          <>
            <div className="pos-filtros" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <label>{config.tiene_pin ? "PIN nuevo" : "PIN (4 a 8 números)"}<input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pin1} onChange={(e) => setPin1(e.target.value.replace(/\D/g, ""))} /></label>
              <label>Repetir PIN<input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))} /></label>
            </div>
            <div className="pos-venta-acc">
              <button disabled={ocupado} onClick={definirPin}>{config.tiene_pin ? "Guardar PIN nuevo" : "Definir PIN"}</button>
              {cambiando && <button className="sec" onClick={() => { setCambiando(false); setPin1(""); setPin2(""); }}>Cancelar</button>}
            </div>
          </>
        )}
        {config.tiene_pin && !cambiando && (
          <div className="pos-venta-acc">
            <button className="sec" onClick={() => setCambiando(true)}>Cambiar PIN</button>
            <button className="sec peligro" disabled={ocupado} onClick={quitarPin}>Quitar PIN</button>
          </div>
        )}
        <label style={{ display: "flex", gap: ".5rem", alignItems: "center", marginTop: ".6rem" }}><input type="checkbox" checked={pinAnular} onChange={(e) => setPinAnular(e.target.checked)} /> Pedir PIN para anular ventas</label>
        <label style={{ display: "flex", gap: ".5rem", alignItems: "center" }}><input type="checkbox" checked={pinDev} onChange={(e) => setPinDev(e.target.checked)} /> Pedir PIN para hacer devoluciones</label>
        {(pinAnular !== config.pin_anular || pinDev !== config.pin_devolucion) && <div className="pos-modal-acciones"><button disabled={ocupado} onClick={guardarOpcionesPin}>Guardar estas opciones</button></div>}
      </div>
      {modal}
    </div>
  );
}
