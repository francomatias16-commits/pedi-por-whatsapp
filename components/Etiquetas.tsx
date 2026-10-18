"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { supabase, type Kiosco } from "@/lib/supabase";
import { peso } from "@/lib/whatsapp";
import type { Promo } from "@/lib/pos/promos";
import {
  CONFIG_DEFECTO, anchoHojaMm, expandir, precioEtiqueta, resolverCodigo, totalEtiquetas, validarConfig,
  type ConfigEtiquetas, type ProductoEtiqueta, type Seleccion,
} from "@/lib/etiquetas";

const PRESETS: [string, Partial<ConfigEtiquetas>][] = [
  ["Rollo 50 × 25 mm", { ancho_mm: 50, alto_mm: 25, columnas: 1, margen_mm: 0 }],
  ["Hoja 3 columnas 50 × 25", { ancho_mm: 50, alto_mm: 25, columnas: 3, margen_mm: 2 }],
  ["Góndola 60 × 40 mm", { ancho_mm: 60, alto_mm: 40, columnas: 3, margen_mm: 2 }],
];
const MAX_ETIQUETAS = 500;
const num = (s: string) => Number(String(s).replace(",", "."));
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function Barras({ valor, formato, alto }: { valor: string; formato: string; alto: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try { JsBarcode(ref.current, valor, { format: formato, displayValue: false, margin: 0, height: 40 }); }
    catch { ref.current.innerHTML = ""; } // un código inválido no tira abajo toda la hoja
  }, [valor, formato]);
  return <svg ref={ref} className="etq-barras" style={{ maxHeight: `${alto}mm` }} />;
}

export default function Etiquetas({ kiosco, precarga, onPrecargaUsada }: { kiosco: Kiosco; precarga?: Seleccion[] | null; onPrecargaUsada?: () => void }) {
  const [productos, setProductos] = useState<ProductoEtiqueta[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [config, setConfig] = useState<ConfigEtiquetas>(CONFIG_DEFECTO);
  const [txt, setTxt] = useState<Record<string, string>>({}); // medidas como texto mientras se escriben
  const [sel, setSel] = useState<Seleccion[]>([]);
  const [busca, setBusca] = useState("");
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [cargado, setCargado] = useState(false);

  const cargar = useCallback(async () => {
    const [p, pr, c] = await Promise.all([
      supabase.from("productos").select("id,nombre,categoria,precio,barcode,plu,vendido_por_peso").eq("kiosco_id", kiosco.id).order("nombre"),
      supabase.from("pos_promos").select("id,nombre,tipo,producto_id,categoria,lleva,paga,pct,desde,hasta,activa").eq("kiosco_id", kiosco.id).eq("activa", true),
      supabase.from("config_etiquetas").select("ancho_mm,alto_mm,columnas,margen_mm,simbologia,mostrar_codigo,mostrar_promos").eq("kiosco_id", kiosco.id).maybeSingle(),
    ]);
    if (p.error) setMsg("No pudimos cargar los productos.");
    setProductos(((p.data ?? []) as ProductoEtiqueta[]).map((x) => ({ ...x, precio: Number(x.precio), vendido_por_peso: !!x.vendido_por_peso })));
    setPromos(((pr.data ?? []) as Promo[]).map((x) => ({ ...x, pct: x.pct == null ? null : Number(x.pct) })));
    if (c.data) setConfig({ ...c.data, ancho_mm: Number(c.data.ancho_mm), alto_mm: Number(c.data.alto_mm), margen_mm: Number(c.data.margen_mm) } as ConfigEtiquetas);
    setCargado(true);
  }, [kiosco.id]);
  useEffect(() => { void cargar(); }, [cargar]);

  // Precarga desde una compra: una etiqueta por unidad comprada (por peso, una sola).
  useEffect(() => {
    if (!precarga || !cargado) return;
    setSel(precarga.filter((s) => productos.some((p) => p.id === s.producto_id)));
    onPrecargaUsada?.();
  }, [precarga, cargado, productos, onPrecargaUsada]);

  const cfgValor = (k: "ancho_mm" | "alto_mm" | "margen_mm" | "columnas") => txt[k] ?? String(config[k]);
  function setMedida(k: "ancho_mm" | "alto_mm" | "margen_mm" | "columnas", v: string) {
    setTxt((t) => ({ ...t, [k]: v }));
    const n = num(v);
    if (v.trim() !== "" && Number.isFinite(n)) setConfig((c) => ({ ...c, [k]: n }));
  }
  function aplicarPreset(p: Partial<ConfigEtiquetas>) { setTxt({}); setConfig((c) => ({ ...c, ...p })); }
  const errorCfg = validarConfig(config);

  async function guardarConfig() {
    if (errorCfg) return setMsg(errorCfg);
    setOcupado(true); setMsg("");
    const { error } = await supabase.from("config_etiquetas").upsert({ kiosco_id: kiosco.id, ...config, updated_at: new Date().toISOString() });
    setOcupado(false);
    setMsg(error ? "No pudimos guardar la configuración." : "Configuración guardada");
  }

  const elegidos = useMemo(() => new Set(sel.map((s) => s.producto_id)), [sel]);
  const resultados = useMemo(() => {
    const q = norm(busca.trim());
    if (!q) return [];
    return productos.filter((p) => !elegidos.has(p.id) && (norm(p.nombre).includes(q) || (p.barcode ?? "").includes(q) || (p.plu ?? "") === q)).slice(0, 8);
  }, [busca, productos, elegidos]);

  const agregar = (id: string) => { setSel((s) => [...s, { producto_id: id, copias: 1 }]); setBusca(""); };
  const setCopias = (id: string, v: string) => setSel((s) => s.map((x) => x.producto_id === id ? { ...x, copias: Math.max(0, Math.min(999, Math.floor(num(v)) || 0)) } : x));
  const quitar = (id: string) => setSel((s) => s.filter((x) => x.producto_id !== id));
  const agregarCategoria = (cat: string) => setSel((s) => [...s, ...productos.filter((p) => p.categoria === cat && !elegidos.has(p.id)).map((p) => ({ producto_id: p.id, copias: 1 }))]);
  const categorias = useMemo(() => [...new Set(productos.map((p) => p.categoria))].sort(), [productos]);

  const lista = useMemo(() => expandir(sel, productos), [sel, productos]);
  const total = totalEtiquetas(sel);
  const sinCodigo = useMemo(() => sel.filter((s) => s.copias > 0).map((s) => productos.find((p) => p.id === s.producto_id)).filter((p): p is ProductoEtiqueta => !!p && !resolverCodigo(p, config.simbologia)), [sel, productos, config.simbologia]);

  function imprimir() {
    if (errorCfg) return setMsg(errorCfg);
    if (total === 0) return setMsg("Elegí al menos un producto.");
    if (total > MAX_ETIQUETAS) return setMsg(`Son demasiadas etiquetas juntas (máximo ${MAX_ETIQUETAS}). Imprimí en dos tandas.`);
    setMsg("");
    // @page con las medidas reales de la hoja; se quita al terminar para no afectar la impresión del ticket.
    const st = document.createElement("style");
    st.id = "etq-page";
    st.textContent = `@page { size: ${anchoHojaMm(config)}mm auto; margin: 0; }`;
    document.head.appendChild(st);
    const quitar = () => { st.remove(); window.removeEventListener("afterprint", quitar); };
    window.addEventListener("afterprint", quitar);
    window.print();
  }

  const altoBarras = Math.max(6, config.alto_mm * 0.32);
  const grilla: React.CSSProperties = { gridTemplateColumns: `repeat(${Math.max(1, config.columnas)}, ${config.ancho_mm}mm)`, gap: `${config.margen_mm}mm`, padding: `${config.margen_mm}mm` };
  const itemEstilo: React.CSSProperties = { width: `${config.ancho_mm}mm`, height: `${config.alto_mm}mm` };

  return (
    <div>
      <h2>Etiquetas de precio</h2>
      <p className="mut">Elegí los productos, cuántas etiquetas de cada uno, y imprimí en tu rollo o en hojas troqueladas.</p>
      {msg && <p role="status" className="mut no-print">{msg}</p>}

      <div className="card no-print">
        <h3>Medidas de la etiqueta</h3>
        <div className="row" style={{ justifyContent: "flex-start", gap: 8, flexWrap: "wrap" }}>
          {PRESETS.map(([n, p]) => <button key={n} className="sec" onClick={() => aplicarPreset(p)}>{n}</button>)}
        </div>
        <div className="etq-form">
          <div><label htmlFor="cfg-ancho">Ancho (mm)</label><input id="cfg-ancho" inputMode="decimal" value={cfgValor("ancho_mm")} onChange={(e) => setMedida("ancho_mm", e.target.value)} /></div>
          <div><label htmlFor="cfg-alto">Alto (mm)</label><input id="cfg-alto" inputMode="decimal" value={cfgValor("alto_mm")} onChange={(e) => setMedida("alto_mm", e.target.value)} /></div>
          <div><label htmlFor="cfg-col">Columnas</label><input id="cfg-col" inputMode="numeric" value={cfgValor("columnas")} onChange={(e) => setMedida("columnas", e.target.value)} /></div>
          <div><label htmlFor="cfg-margen">Margen (mm)</label><input id="cfg-margen" inputMode="decimal" value={cfgValor("margen_mm")} onChange={(e) => setMedida("margen_mm", e.target.value)} /></div>
          <div><label>Tipo de código</label>
            <select aria-label="Tipo de código de barras" value={config.simbologia} onChange={(e) => setConfig((c) => ({ ...c, simbologia: e.target.value as ConfigEtiquetas["simbologia"] }))}>
              <option value="auto">Automático</option><option value="ean13">EAN-13 cuando se pueda</option><option value="code128">Siempre Code 128</option>
            </select></div>
        </div>
        <label className="etq-check"><input type="checkbox" checked={config.mostrar_codigo} onChange={(e) => setConfig((c) => ({ ...c, mostrar_codigo: e.target.checked }))} /> Mostrar el número debajo del código</label>
        <label className="etq-check"><input type="checkbox" checked={config.mostrar_promos} onChange={(e) => setConfig((c) => ({ ...c, mostrar_promos: e.target.checked }))} /> Mostrar promos (precio anterior tachado)</label>
        {errorCfg && <p className="mut" style={{ color: "var(--danger)" }}>{errorCfg}</p>}
        <button className="sec" disabled={ocupado || !!errorCfg} onClick={guardarConfig}>Guardar como mi configuración</button>
      </div>

      <div className="card no-print">
        <h3>Productos a imprimir</h3>
        <input type="search" aria-label="Buscar producto para el cartel" placeholder="Buscar por nombre, código o PLU" value={busca} onChange={(e) => setBusca(e.target.value)} />
        {resultados.map((p) => (
          <div key={p.id} className="row" style={{ marginTop: 6 }}>
            <span>{p.nombre} <span className="mut">· {peso(p.precio)}{p.vendido_por_peso ? "/kg" : ""}</span></span>
            <button className="sec" onClick={() => agregar(p.id)}>Agregar</button>
          </div>
        ))}
        {categorias.length > 0 && (
          <div className="row" style={{ justifyContent: "flex-start", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            <span className="mut">Toda una categoría:</span>
            {categorias.map((c) => <button key={c} className="sec" onClick={() => agregarCategoria(c)}>{c}</button>)}
          </div>
        )}
        {sel.map((s) => {
          const p = productos.find((x) => x.id === s.producto_id);
          if (!p) return null;
          return (
            <div key={s.producto_id} className="row" style={{ marginTop: 8 }}>
              <span>{p.nombre}</span>
              <span className="row" style={{ gap: 6 }}>
                <input aria-label={`Etiquetas de ${p.nombre}`} inputMode="numeric" style={{ width: 70 }} value={String(s.copias)} onChange={(e) => setCopias(s.producto_id, e.target.value)} />
                <button className="sec" onClick={() => quitar(s.producto_id)} aria-label={`Quitar ${p.nombre}`}>✕</button>
              </span>
            </div>
          );
        })}
        {sinCodigo.length > 0 && <p className="mut" style={{ color: "var(--danger)" }}>Sin código para imprimir: {sinCodigo.map((p) => p.nombre).join(", ")}. {sinCodigo.some((p) => p.vendido_por_peso) ? "Los productos por peso necesitan un PLU de hasta 5 números. " : ""}Saldrán solo con el precio.</p>}
        <div className="row" style={{ marginTop: 12 }}>
          <span className="mut">{total} etiqueta{total === 1 ? "" : "s"}</span>
          <button disabled={total === 0 || !!errorCfg} onClick={imprimir}>Imprimir</button>
        </div>
      </div>

      {lista.length > 0 && <h3 className="no-print">Vista previa</h3>}
      <div id="etiquetas-imprimible" className="etq-grilla" style={grilla}>
        {lista.slice(0, MAX_ETIQUETAS).map((p, i) => {
          const pe = precioEtiqueta(p, config.mostrar_promos ? promos : []);
          const cod = resolverCodigo(p, config.simbologia);
          const u = p.vendido_por_peso ? " /kg" : "";
          return (
            <div key={i} className="etq-item" style={itemEstilo}>
              <div className="etq-nombre">{p.nombre}</div>
              {pe.promo != null ? (<>
                <div className="etq-regular">{peso(pe.regular)}{u}</div>
                <div className="etq-precio etq-promo">{peso(pe.promo)}{u}</div>
              </>) : <div className="etq-precio">{peso(pe.regular)}{u}</div>}
              {pe.leyenda && <div className="etq-leyenda">{pe.leyenda}</div>}
              {cod && <Barras valor={cod.valor} formato={cod.formato} alto={altoBarras} />}
              {cod && config.mostrar_codigo && <div className="etq-num">{cod.valor}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
