"use client";
import { useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { armarExportacion, fechaDeBorrado, nombreArchivo, SECCIONES_EXPORTABLES } from "@/lib/exportar";
import { mensajeErrorSql } from "@/lib/errores";
import { useConfirmar } from "@/components/ui/Confirmar";

// Exportar los datos del local y pedir la baja de la cuenta. La baja cierra la tienda y se puede deshacer 30 días.
export default function MisDatos({ kiosco, onCambio }: { kiosco: Kiosco; onCambio: () => void }) {
  const [ventana, confirmar] = useConfirmar();
  const [bajando, setBajando] = useState(false);
  const [progreso, setProgreso] = useState("");
  const [msg, setMsg] = useState("");
  const [nombre, setNombre] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const baja = kiosco.baja_solicitada_at ?? null;

  async function exportar() {
    setBajando(true); setMsg(""); setProgreso("");
    try {
      const datos: Record<string, unknown> = {};
      for (let i = 0; i < SECCIONES_EXPORTABLES.length; i++) {
        const s = SECCIONES_EXPORTABLES[i];
        setProgreso(`Preparando tus datos… ${i + 1} de ${SECCIONES_EXPORTABLES.length}`);
        const { data, error } = await supabase.rpc("kiosco_exportar_seccion", { p_kiosco: kiosco.id, p_seccion: s });
        if (error) throw new Error(error.message);
        datos[s] = data;
      }
      const blob = new Blob([JSON.stringify(armarExportacion(datos), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = nombreArchivo(kiosco.slug); a.click();
      URL.revokeObjectURL(url);
      setMsg("Listo. El archivo se guardó en tu dispositivo.");
    } catch (e) {
      setMsg(mensajeErrorSql(e instanceof Error ? e.message : ""));
    } finally { setBajando(false); setProgreso(""); }
  }

  async function pedirBaja() {
    const si = await confirmar({
      titulo: "¿Dar de baja tu cuenta?",
      detalle: "Tu tienda se cierra ahora y no recibe más pedidos. Guardamos tus datos 30 días por si te arrepentís. Después se borran para siempre.",
      confirmar: "Sí, dar de baja", cancelar: "No, volver", peligro: true,
    });
    if (!si) return;
    setTrabajando(true); setMsg("");
    const { error } = await supabase.rpc("kiosco_pedir_baja", { p_kiosco: kiosco.id, p_nombre: nombre });
    setTrabajando(false);
    if (error) { setMsg(mensajeErrorSql(error.message)); return; }
    setNombre(""); onCambio();
  }

  async function cancelarBaja() {
    setTrabajando(true); setMsg("");
    const { error } = await supabase.rpc("kiosco_cancelar_baja", { p_kiosco: kiosco.id });
    setTrabajando(false);
    if (error) { setMsg(mensajeErrorSql(error.message)); return; }
    setMsg("Listo. Tu cuenta sigue activa. La tienda quedó cerrada: abrila cuando quieras.");
    onCambio();
  }

  return (
    <div>
      {ventana}
      <h3 style={{ marginTop: 0 }}>Bajar mis datos</h3>
      <p className="mut">Te llevás un archivo con tus productos, clientes, pedidos, ventas, compras y fiado. Sirve de copia de seguridad o para cambiar de sistema.</p>
      <button type="button" className="sec" onClick={exportar} disabled={bajando}>{bajando ? "Preparando…" : "Bajar mis datos"}</button>
      {progreso && <p role="status" className="mut">{progreso}</p>}

      <h3>Dar de baja la cuenta</h3>
      {baja ? (
        <div className="card" role="note">
          <p style={{ marginTop: 0 }}><b>Tu cuenta está en baja.</b> Se borra el {fechaDeBorrado(baja).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })}. Hasta entonces podés arrepentirte.</p>
          <button type="button" className="principal" onClick={cancelarBaja} disabled={trabajando}>Mantener mi cuenta</button>
        </div>
      ) : (
        <>
          <p className="mut">Cierra tu tienda y borra tus datos a los 30 días. Antes de dar de baja, conviene bajar tus datos.</p>
          <label>Para confirmar, escribí el nombre de tu local: <b>{kiosco.nombre}</b>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" />
          </label>
          <button type="button" className="peligro" onClick={pedirBaja} disabled={trabajando || nombre.trim().toLowerCase() !== kiosco.nombre.trim().toLowerCase()}>Dar de baja mi cuenta</button>
        </>
      )}
      {msg && <p role="status" className="mut">{msg}</p>}
    </div>
  );
}
