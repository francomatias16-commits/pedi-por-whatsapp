"use client";
import { useConfirmar } from "@/components/ui/Confirmar";
import { useCallback, useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { peso } from "@/lib/whatsapp";
import { margenPct, productosMargenBajo } from "@/lib/margen";
import Pantalla from "@/components/ui/Pantalla";
import Aviso from "@/components/ui/Aviso";

type Prev = { producto_id: string; nombre: string; categoria: string; precio_anterior: number; precio_nuevo: number };
type Ajuste = { id: string; porcentaje: number; tipo: "porcentaje" | "margen"; categoria: string | null; cantidad: number; created_at: string; revertido_at: string | null };
type PrevMargen = { producto_id: string; nombre: string; categoria: string; costo: number; precio_anterior: number; precio_nuevo: number; margen_actual: number | null };

export default function Precios({ kiosco }: { kiosco: Kiosco }) {
  const [ventanaConfirmar, confirmar] = useConfirmar();
  const [pct, setPct] = useState("");
  const [cat, setCat] = useState("");
  const [red, setRed] = useState(10);
  const [cats, setCats] = useState<string[]>([]);
  const [prev, setPrev] = useState<Prev[] | null>(null);
  const [hist, setHist] = useState<Ajuste[]>([]);
  const [msg, setMsg] = useState(""); const [ocupado, setOcupado] = useState(false);
  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  // Margen y costo
  const [objetivo, setObjetivo] = useState("35");
  const [prods, setProds] = useState<{ id: string; nombre: string; precio: number; costo: number | null }[]>([]);
  const [prevM, setPrevM] = useState<PrevMargen[] | null>(null);
  const [msgM, setMsgM] = useState("");
  const objNum = Number(objetivo.replace(",", "."));
  const objOk = objetivo !== "" && objNum >= 1 && objNum <= 95;
  const pctNum = Number(pct.replace(",", "."));
  const pctOk = pct !== "" && pctNum !== 0 && pctNum >= -50 && pctNum <= 200;

  const cargar = useCallback(async () => {
    const [c, h] = await Promise.all([
      supabase.from("productos").select("categoria").eq("kiosco_id", kiosco.id),
      supabase.from("ajustes_precios").select("id,porcentaje,tipo,categoria,cantidad,created_at,revertido_at").eq("kiosco_id", kiosco.id).order("created_at", { ascending: false }).limit(10),
    ]);
    setCats([...new Set((c.data ?? []).map((x) => x.categoria as string))].sort());
    setHist((h.data ?? []).map((a) => ({ ...a, porcentaje: Number(a.porcentaje) })) as Ajuste[]);
    const { data: pr } = await supabase.from("productos").select("id,nombre,precio,costo").eq("kiosco_id", kiosco.id);
    setProds((pr ?? []).map((p) => ({ id: p.id as string, nombre: p.nombre as string, precio: Number(p.precio), costo: p.costo === null ? null : Number(p.costo) })));
  }, [kiosco.id]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { setPrev(null); setPrevM(null); }, [pct, cat, red, objetivo]);

  const args = { p_kiosco: kiosco.id, p_pct: pctNum, p_categoria: cat || null, p_redondeo: red };

  async function previsualizar() {
    setMsg(""); setOcupado(true);
    const { data, error } = await supabase.rpc("previsualizar_ajuste", args);
    setOcupado(false);
    if (error) { setMsg("No se pudo calcular la vista previa."); return; }
    const rows = (data ?? []).map((r: Prev) => ({ ...r, precio_anterior: Number(r.precio_anterior), precio_nuevo: Number(r.precio_nuevo) }));
    setPrev(rows); setPaso(2); if (rows.length === 0) setMsg("Con esos datos ningún precio cambia.");
  }

  async function aplicar() {
    if (!prev || !await confirmar({ titulo: `¿Cambiar el precio de ${prev.length} productos (${pctNum > 0 ? "+" : ""}${pctNum}%)?`, confirmar: "Sí, seguir", peligro: false })) return;
    setOcupado(true);
    const { data, error } = await supabase.rpc("ajustar_precios", args);
    setOcupado(false);
    if (error) { setMsg("No se pudo aplicar el ajuste."); return; }
    setMsg(`Listo: ${data.cantidad} precios actualizados`); setPct(""); setPrev(null); setPaso(1); await cargar();
  }

  async function previsualizarMargen() {
    setMsgM(""); setOcupado(true);
    const { data, error } = await supabase.rpc("previsualizar_margen", { p_kiosco: kiosco.id, p_margen: objNum, p_categoria: cat || null, p_redondeo: red });
    setOcupado(false);
    if (error) { setMsgM("No se pudo calcular la vista previa."); return; }
    const rows = (data ?? []).map((r: PrevMargen) => ({ ...r, costo: Number(r.costo), precio_anterior: Number(r.precio_anterior), precio_nuevo: Number(r.precio_nuevo), margen_actual: r.margen_actual === null ? null : Number(r.margen_actual) }));
    setPrevM(rows); if (rows.length === 0) setMsgM("Con ese margen ningún precio sube.");
  }

  async function aplicarMargen() {
    if (!prevM || !await confirmar({ titulo: `¿Subir el precio de ${prevM.length} productos para que tengan ${objNum}% de margen?`, confirmar: "Sí, seguir", peligro: false })) return;
    setOcupado(true);
    const { data, error } = await supabase.rpc("ajustar_precios_por_margen", { p_kiosco: kiosco.id, p_margen: objNum, p_categoria: cat || null, p_redondeo: red });
    setOcupado(false);
    if (error) { setMsgM("No se pudo aplicar el ajuste."); return; }
    setMsgM(`Listo: ${data.cantidad} precios actualizados`); setPrevM(null); cargar();
  }

  const bajos = productosMargenBajo(prods, objOk ? objNum : 0);

  async function deshacer(a: Ajuste) {
    if (!await confirmar({ titulo: `¿Deshacer el ajuste del ${new Date(a.created_at).toLocaleDateString("es-AR")}?`, confirmar: "Sí, seguir", peligro: true })) return;
    const { data, error } = await supabase.rpc("revertir_ajuste", { p_ajuste: a.id });
    if (error) { setMsg("No se pudo deshacer."); return; }
    setMsg(`Se restauraron ${data.revertidos} precios${data.omitidos ? ` (${data.omitidos} se dejaron porque los cambiaste a mano después)` : ""}.`); setPaso(1); cargar();
  }

  const subeOBaja = pctNum > 0 ? "sube" : "baja";
  const nombreCat = cat || "todo el catálogo";

  return (
    <Pantalla titulo="Cambiar precios" ayuda="Subí o bajá varios precios juntos. Primero mirá cómo queda: no se cambia nada hasta que toques “Aplicar cambios”. Si te equivocás, lo podés deshacer abajo.">
      {ventanaConfirmar}
      <div className="pasos" role="list" aria-label="Pasos">
        {(["Cuánto", "Mirá cómo queda", "Aplicar"] as const).map((t, i) => (
          <span key={t} role="listitem" className={`paso${paso === i + 1 ? " on" : paso > i + 1 ? " hecho" : ""}`} aria-current={paso === i + 1 ? "step" : undefined}>
            <b>{i + 1}</b> {t}
          </span>
        ))}
      </div>

      {paso === 1 && (
        <div className="card">
          <h3>¿Cuánto cambia el precio?</h3>
          <label>Porcentaje (ej. 10 sube 10 %, -5 baja 5 %)<input value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" placeholder="Ej: 10" /></label>
          <label style={{ marginTop: 10 }}>¿A qué productos?
            <select value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">Todo el catálogo</option>
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label style={{ marginTop: 10 }}>Redondear a
            <select value={red} onChange={(e) => setRed(Number(e.target.value))}>
              <option value={0}>Sin redondeo</option><option value={10}>$10</option><option value={50}>$50</option><option value={100}>$100</option>
            </select>
          </label>
          {pct !== "" && !pctOk && <Aviso tipo="error">El porcentaje tiene que estar entre -50 y 200, y no puede ser 0.</Aviso>}
          {msg && <Aviso tipo="info">{msg}</Aviso>}
          <button className="principal" disabled={!pctOk || ocupado} onClick={previsualizar} style={{ marginTop: 12 }}>{ocupado ? "Calculando…" : "Ver cómo queda"}</button>
        </div>
      )}

      {paso === 2 && prev && (
        <div className="card">
          <h3>{prev.length === 0 ? "Ningún precio cambia" : `${prev.length} precios ${subeOBaja} en ${nombreCat}`}</h3>
          {prev.length === 0 && <Aviso tipo="info">Con esos datos no cambia ningún precio. Volvé y probá con otro porcentaje.</Aviso>}
          {prev.slice(0, 12).map((p) => (
            <div className="fila-precio" key={p.producto_id}>
              <span className="fila-precio-nombre">{p.nombre}</span>
              <span className="fila-precio-cifras"><s className="mut">{peso(p.precio_anterior)}</s> → <b>{peso(p.precio_nuevo)}</b></span>
            </div>
          ))}
          {prev.length > 12 && <p className="mut">…y {prev.length - 12} más.</p>}
          <div className="acciones" style={{ marginTop: 12 }}>
            <button className="sec" onClick={() => setPaso(1)}>Volver</button>
            {prev.length > 0 && <button className="principal" onClick={() => setPaso(3)}>Seguir</button>}
          </div>
        </div>
      )}

      {paso === 3 && prev && (
        <div className="card">
          <h3>Último paso: aplicar</h3>
          <p>Vas a cambiar <b>{prev.length} precios</b> ({pctNum > 0 ? "+" : ""}{pctNum} %) en {nombreCat}.</p>
          <div className="acciones" style={{ marginTop: 12 }}>
            <button className="sec" disabled={ocupado} onClick={() => setPaso(2)}>Volver</button>
            <button className="principal" disabled={ocupado} onClick={aplicar}>{ocupado ? "Aplicando…" : `Aplicar cambios a ${prev.length} productos`}</button>
          </div>
        </div>
      )}

      {paso === 1 && msg.startsWith("Listo") && hist[0] && !hist[0].revertido_at && (
        <Aviso tipo="ok">
          {msg} <button type="button" className="sec" onClick={() => deshacer(hist[0])}>Deshacer este cambio</button>
        </Aviso>
      )}

      <h3>Precios según el costo</h3>
      <p className="mut" style={{ margin: ".2rem 0" }}>El margen es lo que queda del precio de venta después de pagar la mercadería. Solo sube precios; nunca baja uno.</p>
      <label>Margen objetivo (%)<input value={objetivo} onChange={(e) => setObjetivo(e.target.value)} inputMode="decimal" placeholder="35" /></label>
      {objetivo !== "" && !objOk && <p role="alert" style={{ color: "var(--danger)" }}>El margen tiene que estar entre 1 y 95.</p>}
      {objOk && (
        <>
          <p className="mut">{bajos.length === 0 ? "Todos los productos con costo cargado llegan al margen objetivo." : `${bajos.length} producto${bajos.length === 1 ? "" : "s"} por debajo del margen objetivo:`}</p>
          {bajos.slice(0, 8).map((p) => (
            <div className="row" key={p.id}><span>{p.nombre}</span><span className="mut">{p.margen}% · precio {peso(p.precio)}</span></div>
          ))}
          {bajos.length > 8 && <p className="mut">…y {bajos.length - 8} más.</p>}
          <button disabled={!objOk || ocupado} onClick={previsualizarMargen} style={{ marginTop: 8 }}>Ver precios sugeridos por costo</button>
          {msgM && <p role="status" className="mut">{msgM}</p>}
          {prevM && prevM.length > 0 && (
            <>
              <h2>{prevM.length} precios van a subir</h2>
              {prevM.slice(0, 12).map((p) => (
                <div className="row" key={p.producto_id}><span>{p.nombre} <span className="mut">({p.margen_actual ?? 0}% → {objNum}%)</span></span><span><s className="mut">{peso(p.precio_anterior)}</s> → <b>{peso(p.precio_nuevo)}</b></span></div>
              ))}
              {prevM.length > 12 && <p className="mut">…y {prevM.length - 12} más.</p>}
              <button disabled={ocupado} onClick={aplicarMargen} style={{ marginTop: 12 }}>Aplicar precios por margen</button>
            </>
          )}
        </>
      )}

      <h3>Cambios anteriores</h3>
      {hist.length === 0 && <p className="mut">Todavía no hiciste ajustes.</p>}
      {hist.map((a) => (
        <div className="card row" key={a.id}>
          <div>
            <b>{a.tipo === "margen" ? `Margen ${a.porcentaje}%` : `${a.porcentaje > 0 ? "+" : ""}${a.porcentaje}%`}</b> · {a.categoria ?? "todo"} · {a.cantidad} productos
            <div className="mut">{new Date(a.created_at).toLocaleDateString("es-AR")}{a.revertido_at ? " · deshecho" : ""}</div>
          </div>
          {!a.revertido_at && <button className="sec" aria-label={`Deshacer el ajuste del ${new Date(a.created_at).toLocaleDateString("es-AR")}`} onClick={() => deshacer(a)}>Deshacer</button>}
        </div>
      ))}
    </Pantalla>
  );
}
