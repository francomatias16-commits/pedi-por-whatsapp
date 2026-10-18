"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase, type Kiosco, type Producto } from "@/lib/supabase";
import { KIT } from "@/lib/kit";
import { normNombre, parsePlanilla, parsePrecio, type FilaImport } from "@/lib/importar";
import { peso } from "@/lib/whatsapp";

export default function CargaMasiva({ kiosco, existentes, onListo, onCerrar }: { kiosco: Kiosco; existentes: Producto[]; onListo: () => void; onCerrar: () => void }) {
  const [modo, setModo] = useState<"kit" | "planilla">("kit");
  const [precios, setPrecios] = useState<Record<string, string>>({});
  const [texto, setTexto] = useState("");
  const [msg, setMsg] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [proveedores, setProveedores] = useState<{ id: string; nombre: string }[]>([]);

  useEffect(() => {
    supabase.from("proveedores").select("id,nombre").eq("kiosco_id", kiosco.id).eq("activo", true).order("nombre")
      .then(({ data }) => setProveedores((data ?? []) as { id: string; nombre: string }[]));
  }, [kiosco.id]);
  const idPorProveedor = useMemo(() => new Map(proveedores.map((p) => [normNombre(p.nombre), p.id])), [proveedores]);

  const nombres = useMemo(() => new Set(existentes.map((p) => normNombre(p.nombre))), [existentes]);
  const barcodes = useMemo(() => new Set(existentes.map((p) => p.barcode).filter(Boolean) as string[]), [existentes]);
  const kit = useMemo(() => KIT.map(([cat, items]) => [cat, items.filter((n) => !nombres.has(normNombre(n)))] as [string, string[]]).filter(([, i]) => i.length > 0), [nombres]);
  const filasKit = useMemo<FilaImport[]>(() => kit.flatMap(([cat, items]) => items.flatMap((n) => {
    const p = parsePrecio(precios[`${cat}|${n}`] ?? "");
    return p !== null && p > 0 ? [{ nombre: n, precio: p, categoria: cat, barcode: null }] : [];
  })), [kit, precios]);
  const plan = useMemo(() => parsePlanilla(texto, nombres, barcodes, new Set(idPorProveedor.keys())), [texto, nombres, barcodes, idPorProveedor]);

  async function leerArchivo(f: File | undefined) {
    if (!f) return;
    if (f.size > 1_000_000) { setMsg("El archivo es muy grande (máx. 1 MB)."); return; }
    const buf = await f.arrayBuffer();
    let t: string;
    try { t = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { t = new TextDecoder("windows-1252").decode(buf); } // Excel suele guardar CSV en Windows-1252
    setMsg(""); setTexto(t.replace(/^\uFEFF/, ""));
  }

  async function guardar(filas: FilaImport[]) {
    if (guardando || filas.length === 0) return;
    setGuardando(true); setMsg("");
    for (let i = 0; i < filas.length; i += 200) {
      const lote = filas.slice(i, i + 200).map((f) => ({
        kiosco_id: kiosco.id, nombre: f.nombre, precio: f.precio, categoria: f.categoria, barcode: f.barcode,
        ...(f.stock != null ? { stock_controlado: true, stock: f.stock, stock_minimo: f.minimo ?? 0, disponible: f.stock > 0 } : {}),
        ...(f.objetivo != null ? { stock_objetivo: f.objetivo } : {}),
        ...(f.dias != null ? { lead_time_dias: f.dias } : {}),
        ...(f.proveedorNombre ? { proveedor_id: idPorProveedor.get(normNombre(f.proveedorNombre)) ?? null } : {}),
      }));
      const { error } = await supabase.from("productos").insert(lote);
      if (error) {
        setGuardando(false);
        setMsg(error.code === "23505" ? "Hay un código de barras que ya está en tu catálogo. Revisá la planilla." : `No se pudo guardar (se cargaron ${i} de ${filas.length}). Revisá y probá de nuevo.`);
        if (i > 0) onListo();
        return;
      }
    }
    setGuardando(false); setPrecios({}); setTexto(""); setMsg(`Listo. ${filas.length} productos cargados`); onListo();
  }

  return (
    <div className="card">
      <div className="row"><b>Carga masiva</b><button className="sec" onClick={onCerrar}>Cerrar</button></div>
      <div className="chips">
        <button className={modo === "kit" ? "" : "sec"} onClick={() => setModo("kit")}>Kit de kiosco</button>
        <button className={modo === "planilla" ? "" : "sec"} onClick={() => setModo("planilla")}>Pegar planilla</button>
      </div>
      {msg && <p role="status" className="mut">{msg}</p>}

      {modo === "kit" && (
        <>
          <p className="mut">Poné el precio solo de lo que vendés; los vacíos no se cargan. Podés editarlos después. Cigarrillos y alcohol se cargan a mano.</p>
          {kit.length === 0 && <p className="mut">Ya tenés todo el kit cargado.</p>}
          {kit.map(([cat, items]) => (
            <section key={cat}>
              <h2>{cat}</h2>
              {items.map((n) => (
                <div className="row" key={n} style={{ margin: "4px 0" }}>
                  <span style={{ minWidth: 0 }}>{n}</span>
                  <input style={{ width: 110, margin: 0 }} placeholder="Precio" inputMode="decimal" value={precios[`${cat}|${n}`] ?? ""}
                    onChange={(e) => setPrecios({ ...precios, [`${cat}|${n}`]: e.target.value })} aria-label={`Precio de ${n}`} />
                </div>
              ))}
            </section>
          ))}
          <div style={{ position: "sticky", bottom: 0, background: "var(--bg)", padding: "8px 0" }}>
            <button style={{ width: "100%" }} disabled={guardando || filasKit.length === 0} onClick={() => guardar(filasKit)}>
              {guardando ? "Cargando…" : `Cargar ${filasKit.length} productos`}
            </button>
          </div>
        </>
      )}

      {modo === "planilla" && (
        <>
          <p className="mut">Una línea por producto: <b>nombre ; precio ; categoría ; código ; stock ; stock mínimo ; stock objetivo ; días de entrega ; proveedor</b>. Todo lo que va después del precio es opcional; si ponés stock, el producto controla stock. El objetivo es hasta cuánto reponer (tiene que ser mayor o igual al mínimo). El proveedor tiene que estar cargado antes en Proveedores. Podés copiar y pegar desde Excel o Google Sheets.</p>
          <p><label className="mut">O subí un archivo .csv (en Excel: Guardar como → CSV): <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => { leerArchivo(e.target.files?.[0]); e.target.value = ""; }} /></label></p>
          <textarea rows={8} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={"Coca-Cola 2,25 L;3500;Bebidas;7790895000782;24;6;30;3;Coca Dist\nAlfajor triple;900;Golosinas"} />
          {texto.trim() && (
            <>
              <p>✔ {plan.filas.length} para cargar{plan.duplicados > 0 ? ` · ${plan.duplicados} repetidos (se omiten)` : ""}{plan.errores.length > 0 ? ` · ${plan.errores.length} con error` : ""}</p>
              {plan.filas.slice(0, 5).map((f, i) => (<div className="mut" key={i}>{f.nombre} · {f.categoria} · {peso(f.precio)}{f.stock != null ? ` · stock ${f.stock}` : ""}{f.objetivo != null ? ` · objetivo ${f.objetivo}` : ""}{f.dias != null ? ` · ${f.dias} días` : ""}{f.proveedorNombre ? ` · ${f.proveedorNombre}` : ""}</div>))}
              {plan.filas.length > 5 && <div className="mut">… y {plan.filas.length - 5} más</div>}
              {plan.errores.slice(0, 5).map((e, i) => (<div key={i} style={{ color: "var(--danger)" }}>{e.linea > 0 ? `Línea ${e.linea}: ` : ""}{e.motivo}{e.texto ? ` — ${e.texto}` : ""}</div>))}
            </>
          )}
          <button style={{ width: "100%", marginTop: 8 }} disabled={guardando || plan.filas.length === 0} onClick={() => guardar(plan.filas)}>
            {guardando ? "Cargando…" : `Cargar ${plan.filas.length} productos`}
          </button>
        </>
      )}
    </div>
  );
}
