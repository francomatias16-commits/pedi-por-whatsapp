"use client";
import { useConfirmar } from "@/components/ui/Confirmar";
import { useEffect, useState } from "react";
import { supabase, type Kiosco, type Producto } from "@/lib/supabase";
import { linkWhatsApp, peso } from "@/lib/whatsapp";
import { mensajeErrorSql } from "@/lib/errores";

type Fuga = { cliente_id: string; nombre: string; telefono: string; compras: number; ultima_compra: string; dias_sin_comprar: number };
type Regla = { id: string; tipo: "venta_supera" | "fiado_supera" | "stock_bajo_de"; umbral: number; activo: boolean };
type Lote = { lote_id: string | null; vence: string | null; cantidad: number; en_stock: number; estado: string };

const TIPOS: Record<Regla["tipo"], string> = {
  venta_supera: "Las ventas de ayer superan",
  fiado_supera: "El fiado adeudado supera",
  stock_bajo_de: "Hay productos con stock menor a",
};
const ESTADO: Record<string, string> = {
  vigente: "vigente",
  por_vencer: "vence en 7 días o menos",
  vencido: "vencido",
  sin_fecha: "sin fecha de vencimiento",
  consumido: "ya no queda en stock",
};

export default function Radar({ kiosco }: { kiosco: Kiosco }) {
  const [ventanaConfirmar, confirmar] = useConfirmar();
  const [msg, setMsg] = useState("");
  const [dias, setDias] = useState("45");
  const [minimo, setMinimo] = useState("3");
  const [fuga, setFuga] = useState<Fuga[]>([]);
  const [reglas, setReglas] = useState<Regla[]>([]);
  const [tipo, setTipo] = useState<Regla["tipo"]>("venta_supera");
  const [umbral, setUmbral] = useState("");
  const [productos, setProductos] = useState<Producto[]>([]);
  const [prodId, setProdId] = useState("");
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [loteCant, setLoteCant] = useState("");
  const [loteVence, setLoteVence] = useState("");

  async function cargarFuga() {
    const { data, error } = await supabase.rpc("clientes_en_fuga", { p_kiosco: kiosco.id, p_dias_sin_comprar: Number(dias), p_min_compras: Number(minimo) });
    if (error) return setMsg(mensajeErrorSql(error.message));
    setFuga((data ?? []) as Fuga[]);
  }
  async function cargarReglas() {
    const { data } = await supabase.from("avisos_reglas").select("id,tipo,umbral,activo").eq("kiosco_id", kiosco.id).order("created_at");
    setReglas((data ?? []) as Regla[]);
  }
  async function cargarProductos() {
    const { data } = await supabase.from("productos").select("id,nombre,stock,stock_controlado").eq("kiosco_id", kiosco.id).eq("stock_controlado", true).order("nombre");
    setProductos((data ?? []) as Producto[]);
  }
  async function cargarLotes(p: string) {
    if (!p) return setLotes([]);
    const { data, error } = await supabase.rpc("lotes_repartir", { p_producto: p });
    if (error) return setMsg(mensajeErrorSql(error.message));
    setLotes((data ?? []) as Lote[]);
  }
  useEffect(() => { cargarFuga(); cargarReglas(); cargarProductos(); }, [kiosco.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function crearRegla() {
    const { error } = await supabase.rpc("regla_crear", { p_kiosco: kiosco.id, p_tipo: tipo, p_umbral: Number(umbral.replace(",", ".")) });
    if (error) return setMsg(mensajeErrorSql(error.message));
    setUmbral(""); setMsg("Aviso guardado"); cargarReglas();
  }
  async function alternarRegla(r: Regla) {
    const { error } = await supabase.from("avisos_reglas").update({ activo: !r.activo }).eq("id", r.id);
    if (error) return setMsg(mensajeErrorSql(error.message));
    cargarReglas();
  }
  async function agregarLote() {
    const { error } = await supabase.rpc("lote_registrar", { p_producto: prodId, p_cantidad: Number(loteCant), p_vence: loteVence });
    if (error) return setMsg(mensajeErrorSql(error.message));
    setLoteCant(""); setLoteVence(""); setMsg("Lote cargado"); cargarLotes(prodId);
  }
  async function darDeBaja(l: Lote) {
    if (!l.lote_id) return;
    if (!(await confirmar({ titulo: `¿Dar de baja ${l.en_stock} unidad(es) por vencimiento?`, detalle: "Queda registrado como pérdida.", confirmar: "Sí, dar de baja", peligro: true }))) return;
    const { error } = await supabase.rpc("lote_dar_de_baja", { p_lote: l.lote_id, p_cantidad: l.en_stock });
    if (error) return setMsg(mensajeErrorSql(error.message));
    setMsg("Baja registrada"); cargarLotes(prodId); cargarProductos();
  }
  async function cerrarLote(l: Lote) {
    if (!l.lote_id) return;
    const { error } = await supabase.rpc("lote_cerrar", { p_lote: l.lote_id });
    if (error) return setMsg(mensajeErrorSql(error.message));
    cargarLotes(prodId);
  }

  return (
    <div>
      {ventanaConfirmar}
      <h1>Alertas del negocio</h1>
      {msg && <p role="status" className="mut">{msg}</p>}

      <section className="card">
        <h2>Clientes que dejaron de venir</h2>
        <p className="mut">Clientes con {minimo} o más compras en el último año que hace más de {dias} días que no vuelven. Vos decidís qué les mandás: el descuento lo aplicás vos en la caja.</p>
        <div className="row">
          <label>Días sin comprar <input type="number" value={dias} onChange={(e) => setDias(e.target.value)} style={{ width: 90 }} /></label>
          <label>Mínimo de compras <input type="number" value={minimo} onChange={(e) => setMinimo(e.target.value)} style={{ width: 90 }} /></label>
          <button className="sec" onClick={cargarFuga}>Buscar</button>
        </div>
        {fuga.length === 0 && <p className="mut">No hay clientes que dejaron de venir con esos criterios.</p>}
        {fuga.map((c) => (
          <div className="card" key={c.cliente_id} style={{ margin: "8px 0" }}>
            <b>{c.nombre}</b>
            <p className="mut" style={{ margin: ".2rem 0 .5rem" }}>{c.compras} compras · hace {c.dias_sin_comprar} días que no vuelve</p>
            <div className="acciones" style={{ flexWrap: "wrap" }}>
              <a className="btn principal" target="_blank" rel="noreferrer" href={linkWhatsApp(c.telefono, `Hola ${c.nombre.split(" ")[0]}! Hace ${c.dias_sin_comprar} días que no te vemos por ${kiosco.nombre}. Pasá cuando quieras, te esperamos.`)}>Escribirle por WhatsApp</a>
              <a className="btn sec" target="_blank" rel="noreferrer" href={linkWhatsApp(c.telefono, `Hola ${c.nombre.split(" ")[0]}! Te escribimos de ${kiosco.nombre}. Tenés un 10 % de descuento en tu próxima compra. Mostrá este mensaje cuando pases.`)}>Ofrecerle 10 % de descuento</a>
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Mis avisos</h2>
        <p className="mut">Te avisamos en el panel una vez por día cuando se cumple la condición. Fiado y stock avisan como máximo una vez por semana.</p>
        {reglas.map((r) => (
          <div className="row" key={r.id} style={{ margin: "6px 0" }}>
            <span>{TIPOS[r.tipo]} {r.tipo === "stock_bajo_de" ? `${r.umbral} unid.` : peso(r.umbral)}</span>
            <button className="sec" onClick={() => alternarRegla(r)}>{r.activo ? "Pausar" : "Activar"}</button>
          </div>
        ))}
        <div className="row">
          <select aria-label="Tipo de alerta" value={tipo} onChange={(e) => setTipo(e.target.value as Regla["tipo"])}>
            {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input inputMode="decimal" placeholder="Umbral" value={umbral} onChange={(e) => setUmbral(e.target.value)} style={{ width: 120 }} aria-label="Umbral" />
          <button onClick={crearRegla} disabled={!umbral}>Guardar aviso</button>
        </div>
      </section>

      <section className="card">
        <h2>Vencimientos</h2>
        <p className="mut">Cargá la fecha de vencimiento de la mercadería que ya está en stock. El sistema asume que se vende primero lo que vence antes. Esto no cambia precios: si algo vence pronto, conviene liquidarlo a mano.</p>
        <select value={prodId} onChange={(e) => { setProdId(e.target.value); cargarLotes(e.target.value); }} aria-label="Producto">
          <option value="">Elegí un producto con control de stock</option>
          {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre} (stock {p.stock})</option>)}
        </select>
        {prodId && (
          <>
            <div className="row" style={{ marginTop: 8 }}>
              <input inputMode="numeric" placeholder="Unidades" value={loteCant} onChange={(e) => setLoteCant(e.target.value)} style={{ width: 110 }} aria-label="Unidades del lote" />
              <input type="date" value={loteVence} onChange={(e) => setLoteVence(e.target.value)} aria-label="Vencimiento del lote" />
              <button onClick={agregarLote} disabled={!loteCant || !loteVence}>Guardar vencimiento</button>
            </div>
            {lotes.length === 0 && <p className="mut">Todavía no hay lotes cargados para este producto.</p>}
            {lotes.map((l, i) => (
              <div className="row" key={l.lote_id ?? `sf-${i}`} style={{ margin: "6px 0" }}>
                <span style={{ minWidth: 0 }}>
                  {l.vence ? `Vence ${new Date(l.vence + "T12:00:00").toLocaleDateString("es-AR")}` : "Sin fecha"} · {l.en_stock} en stock · {ESTADO[l.estado] ?? l.estado}
                </span>
                {l.lote_id && l.en_stock > 0 && (
                  <span className="row">
                    {(l.estado === "vencido" || l.estado === "por_vencer") && <button className="sec" onClick={() => darDeBaja(l)}>Dar de baja</button>}
                    <button className="sec" onClick={() => cerrarLote(l)}>Ya no queda</button>
                  </span>
                )}
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  );
}
