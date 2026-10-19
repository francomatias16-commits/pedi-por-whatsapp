"use client";
import { useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { NIVELES_SUGERIDOS, TIPOS_NIVEL, validarEtapas, vistaPreviaEtapas, type NivelForm } from "@/lib/promos";
import { mensajeErrorSql } from "@/lib/errores";
import Aviso from "@/components/ui/Aviso";
import { useConfirmar } from "@/components/ui/Confirmar";

type PremioFila = { nombre: string; costo_sellos: number; tipo: NivelForm["tipo"]; producto_id: string | null; valor: number | null; tope_pesos: number | null };
const aForm = (p: PremioFila): NivelForm => ({ nombre: p.nombre, costo_sellos: String(p.costo_sellos), tipo: p.tipo, valor: p.valor == null ? "" : String(p.valor), producto_id: p.producto_id ?? "", tope: p.tope_pesos == null ? "" : String(p.tope_pesos) });

/**
 * Premios por etapas: de 2 a 6 niveles con sellos crecientes. Al guardar, los premios anteriores se pausan (0052).
 * "Deshacer" vuelve a los niveles que había antes del último guardado (0053); si no había ninguno, los quita.
 */
export default function Etapas({ kiosco, onCambio }: { kiosco: Kiosco; onCambio: () => void }) {
  const [niveles, setNiveles] = useState<NivelForm[]>(NIVELES_SUGERIDOS);
  const [actuales, setActuales] = useState<NivelForm[]>([]); // lo que está guardado ahora
  const [antes, setAntes] = useState<NivelForm[] | null>(null); // lo que había antes del último guardado (para deshacer)
  const [productos, setProductos] = useState<{ id: string; nombre: string }[]>([]);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [ventana, confirmar] = useConfirmar();

  useEffect(() => {
    void supabase.from("productos").select("id,nombre").eq("kiosco_id", kiosco.id).order("nombre").then(({ data }) => setProductos((data as { id: string; nombre: string }[]) ?? []));
    // Si ya hay 2 o más premios activos, se parte de ellos.
    void supabase.from("fidelidad_premios").select("nombre,costo_sellos,tipo,producto_id,valor,tope_pesos").eq("kiosco_id", kiosco.id).eq("activo", true).order("costo_sellos").limit(6).then(({ data }) => {
      const f = (data as PremioFila[] | null) ?? [];
      const guardados = f.length >= 2 ? f.map(aForm) : [];
      setActuales(guardados);
      if (guardados.length) setNiveles(guardados);
    });
  }, [kiosco.id]);

  const cambiar = (i: number, c: Partial<NivelForm>) => setNiveles((n) => n.map((x, j) => (j === i ? { ...x, ...c } : x)));
  const nombreProducto = (id: string) => productos.find((p) => p.id === id)?.nombre;

  async function guardar() {
    setMsg("");
    const v = validarEtapas(niveles);
    if (!v.ok) { setOk(false); return setMsg(v.error); }
    if (!(await confirmar({ titulo: "Premios por etapas", detalle: `Vas a dejar ${v.datos.length} niveles. Los premios que tenés ahora se pausan. ¿Lo guardo?`, confirmar: "Sí, guardar", cancelar: "No, volver" }))) return;
    setOcupado(true);
    let r = await supabase.rpc("promo_etapas_guardar", { p_kiosco: kiosco.id, p_niveles: v.datos });
    if (r.error?.message.includes("promo_reduce_margen")) {
      const sigue = await confirmar({ titulo: "Baja el margen", detalle: `Un producto regalado queda por debajo del margen mínimo de ${kiosco.club_margen_minimo ?? 20}%. ¿Guardo igual?`, confirmar: "Sí, guardar igual", cancelar: "No, volver", peligro: true });
      if (!sigue) { setOcupado(false); return; }
      r = await supabase.rpc("promo_etapas_guardar", { p_kiosco: kiosco.id, p_niveles: v.datos, p_confirmar_margen: true });
    }
    setOcupado(false);
    if (r.error) { setOk(false); return setMsg(mensajeErrorSql(r.error.message, "club")); }
    setAntes(actuales); setActuales(niveles); setOk(true); setMsg("Listo, los niveles quedaron guardados. Podés deshacerlo con el botón de abajo."); onCambio();
  }

  async function deshacer() {
    if (antes === null) return;
    setMsg("");
    setOcupado(true);
    let r;
    if (antes.length >= 2) {
      const v = validarEtapas(antes);
      if (!v.ok) { setOcupado(false); setOk(false); return setMsg("No se pudo volver a los niveles anteriores: " + v.error); }
      r = await supabase.rpc("promo_etapas_guardar", { p_kiosco: kiosco.id, p_niveles: v.datos, p_confirmar_margen: true });
    } else {
      r = await supabase.rpc("promo_etapas_quitar", { p_kiosco: kiosco.id });
    }
    setOcupado(false);
    if (r.error) { setOk(false); return setMsg(mensajeErrorSql(r.error.message, "club")); }
    setActuales(antes); if (antes.length >= 2) setNiveles(antes); setAntes(null); setOk(true); setMsg("Listo, se volvió a como estaba antes."); onCambio();
  }

  return (
    <div className="card">
      {ventana}
      <h3>Premios por etapas</h3>
      <p className="mut">Cada nivel es un premio con más sellos que el anterior, y el cliente ve el que sigue en su tarjeta. Ej: 5 una gaseosa, 10 un descuento.</p>
      {niveles.map((n, i) => (
        <div className="fila-sep" key={i}>
          <b>Nivel {i + 1}</b>
          <label>Premio<input value={n.nombre} maxLength={80} onChange={(e) => cambiar(i, { nombre: e.target.value })} /></label>
          <label>Sellos que pide<input inputMode="numeric" value={n.costo_sellos} onChange={(e) => cambiar(i, { costo_sellos: e.target.value })} /></label>
          <label>Tipo
            <select value={n.tipo} onChange={(e) => cambiar(i, { tipo: e.target.value as NivelForm["tipo"] })}>
              {TIPOS_NIVEL.map((t) => <option key={t.clave} value={t.clave}>{t.texto}</option>)}
            </select>
          </label>
          {n.tipo === "producto" && (
            <label>Producto
              <select value={n.producto_id} onChange={(e) => cambiar(i, { producto_id: e.target.value })}>
                <option value="">Elegí un producto</option>
                {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </label>
          )}
          {(n.tipo === "pct" || n.tipo === "monto") && <label>{n.tipo === "pct" ? "Descuento (%)" : "Descuento ($)"}<input inputMode="decimal" value={n.valor} onChange={(e) => cambiar(i, { valor: e.target.value })} /></label>}
          {n.tipo === "pct" && <label>Tope en pesos (opcional)<input inputMode="decimal" value={n.tope ?? ""} placeholder="Sin tope" onChange={(e) => cambiar(i, { tope: e.target.value })} /></label>}
        </div>
      ))}
      <div className="row">
        <button type="button" className="sec" disabled={niveles.length >= 6} onClick={() => setNiveles((n) => [...n, { nombre: "", costo_sellos: String((Number(n[n.length - 1]?.costo_sellos) || 0) + 10), tipo: "libre", valor: "", producto_id: "", tope: "" }])}>Sumar un nivel</button>
        <button type="button" className="sec" disabled={niveles.length <= 2} onClick={() => setNiveles((n) => n.slice(0, -1))}>Sacar el último</button>
      </div>
      <div className="fila-sep" aria-live="polite">
        <b>Así lo verá el cliente</b>
        <ol>{vistaPreviaEtapas(niveles, nombreProducto).map((linea, i) => <li key={i}>{linea}</li>)}</ol>
      </div>
      {msg && <Aviso tipo={ok ? "ok" : "alerta"}>{msg}</Aviso>}
      <button type="button" disabled={ocupado} onClick={guardar}>Guardar niveles</button>
      {antes !== null && <button type="button" className="sec" disabled={ocupado} onClick={deshacer}>Deshacer el último cambio</button>}
    </div>
  );
}
