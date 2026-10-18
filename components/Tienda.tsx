"use client";
import { useConfirmar } from "@/components/ui/Confirmar";
import { useEffect, useMemo, useState } from "react";
import { supabase, type Kiosco, type Producto } from "@/lib/supabase";
import Link from "next/link";
import { estadoTienda, resumenHorario, textoApertura } from "@/lib/horario";
import { ETIQUETA_PAGO, linkWhatsApp, mensajePedido, normalizarTelefonoAR, peso } from "@/lib/whatsapp";

const ERRORES: [string, string][] = [
  ["producto_no_disponible", "Algún producto ya no está disponible. Actualizá la página y armá el pedido de nuevo."],
  ["sin_stock", "Se acabó alguno de los productos del pedido. Revisá el carrito y armalo de nuevo."],
  ["envio_invalido", "Este local no hace envíos, o falta la dirección."],
  ["telefono_invalido", "Revisá el número de WhatsApp."],
  ["nombre_invalido", "Poné tu nombre."],
  ["kiosco_no_encontrado", "No encontramos este local."],
  ["local_cerrado", "El local está cerrado por ahora. Probá más tarde."],
  ["fuera_de_horario", "El local está fuera de su horario de atención. Probá cuando abra."],
  ["minimo_no_alcanzado", "No llegás al monto mínimo del pedido."],
  ["medio_pago_invalido", "Ese medio de pago no está disponible. Elegí otro."],
  ["demasiados_pedidos", "Ya enviaste varios pedidos hace un momento. Esperá unos minutos."],
  ["local_saturado", "El local recibió muchos pedidos juntos. Probá en unos minutos."],
];
const mensajeError = (m: string) => ERRORES.find(([k]) => m.includes(k))?.[1] ?? "No pudimos registrar el pedido. Revisá los datos e intentá de nuevo.";
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const leer = <T,>(k: string, def: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : def; } catch { return def; } };
const guardarLS = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* modo privado: se ignora */ } };

export default function Tienda({ kiosco, productos }: { kiosco: Kiosco; productos: Producto[] }) {
  const [ventanaConfirmar, confirmar] = useConfirmar();
  const kCart = `cart:${kiosco.slug}`;
  const [cart, setCart] = useState<Record<string, number>>({});
  const [hidratado, setHidratado] = useState(false);
  const [paso, setPaso] = useState<"catalogo" | "datos" | "listo">("catalogo");
  const [nombre, setNombre] = useState("");
  const [tel, setTel] = useState("");
  const [modalidad, setModalidad] = useState<"retiro" | "envio">("retiro");
  const [dir, setDir] = useState("");
  const [notas, setNotas] = useState("");
  const [medio, setMedio] = useState(kiosco.medios_pago?.[0] ?? "efectivo");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  // La hora se toma recién en el navegador (no en el servidor) para que no se desfase con la página en caché.
  const [ahora, setAhora] = useState<Date | null>(null);
  useEffect(() => { setAhora(new Date()); const t = setInterval(() => setAhora(new Date()), 30000); return () => clearInterval(t); }, []);
  const [q, setQ] = useState("");
  const [catSel, setCatSel] = useState("Todas");
  const [listo, setListo] = useState<{ link: string; total: number; numero?: number } | null>(null);

  // Recupera el carrito y los datos del cliente (si volvió o cerró la pestaña sin querer).
  useEffect(() => {
    const ids = new Set(productos.map((p) => p.id));
    const guardado = leer<Record<string, number>>(kCart, {});
    setCart(Object.fromEntries(Object.entries(guardado).filter(([id, n]) => ids.has(id) && n > 0)));
    const d = leer<{ nombre?: string; tel?: string; dir?: string }>("cliente", {});
    setNombre(d.nombre ?? ""); setTel(d.tel ?? ""); setDir(d.dir ?? "");
    setHidratado(true);
  }, [kCart, productos]);
  useEffect(() => { if (hidratado) guardarLS(kCart, cart); }, [cart, hidratado, kCart]);

  const items = useMemo(() => productos.filter((p) => cart[p.id]).map((p) => ({ p, cant: cart[p.id] })), [cart, productos]);
  const total = items.reduce((s, i) => s + Number(i.p.precio) * i.cant, 0);
  const cantTotal = items.reduce((s, i) => s + i.cant, 0);
  const minimo = Number(kiosco.pedido_minimo ?? 0);
  const bajoMinimo = total < minimo;
  const envio = modalidad === "envio" ? Number(kiosco.costo_envio ?? 0) : 0;
  const estado = ahora ? estadoTienda(kiosco, ahora) : kiosco.abierto === false ? "pausada" : "abierta";
  const cerrado = estado !== "abierta";
  const proxima = estado === "fuera_de_horario" && ahora ? textoApertura(kiosco.horarios ?? {}, ahora) : null;
  const horarioTexto = kiosco.horario_auto ? resumenHorario(kiosco.horarios ?? {}) : kiosco.horario;
  const categorias = useMemo(() => Array.from(new Set(productos.map((p) => p.categoria))), [productos]);
  const porCategoria = useMemo(() => {
    const nq = norm(q.trim());
    const m = new Map<string, Producto[]>();
    productos
      .filter((p) => (catSel === "Todas" || p.categoria === catSel) && (!nq || norm(p.nombre).includes(nq)))
      .forEach((p) => m.set(p.categoria, [...(m.get(p.categoria) ?? []), p]));
    return [...m.entries()];
  }, [productos, q, catSel]);

  useEffect(() => { if (paso === "datos" && cantTotal === 0) setPaso("catalogo"); }, [paso, cantTotal]);

  const cambiar = (id: string, d: number) =>
    setCart((c) => { const n = Math.min(99, Math.max(0, (c[id] ?? 0) + d)); const x = { ...c }; if (n) x[id] = n; else delete x[id]; return x; });

  async function enviar() {
    setError(""); setEnviando(true);
    const { data, error: err } = await supabase.rpc("crear_pedido", {
      p_slug: kiosco.slug, p_nombre: nombre.trim(), p_telefono: tel, p_modalidad: modalidad,
      p_direccion: dir, p_notas: notas, p_items: items.map((i) => ({ producto_id: i.p.id, cantidad: i.cant })), p_medio_pago: medio,
    });
    setEnviando(false);
    if (err) { setError(mensajeError(err.message ?? "")); return; }
    const texto = mensajePedido({
      numero: data.numero, nombre: nombre.trim(), telefono: tel, modalidad, direccion: dir, notas,
      costoEnvio: Number(data.costo_envio ?? 0), medioPago: medio,
      items: items.map((i) => ({ nombre: i.p.nombre, cantidad: i.cant, precio: Number(i.p.precio) })),
      total: Number(data.total),
    });
    const link = linkWhatsApp(normalizarTelefonoAR(kiosco.whatsapp), texto);
    guardarLS("cliente", { nombre: nombre.trim(), tel, dir });
    setCart({}); setNotas(""); setListo({ link, total: Number(data.total), numero: data.numero }); setPaso("listo");
    window.location.href = link;
  }

  if (paso === "listo" && listo) return (
    <>
      <h1>¡Pedido enviado! ✔</h1>
      <p>{listo.numero ? `Pedido #${listo.numero} · ` : ""}Total {peso(listo.total)}. <b>{kiosco.nombre}</b> lo va a confirmar por WhatsApp.</p>
      <p className="mut">Si no se abrió WhatsApp, tocá el botón: es el mensaje que le avisa al local.</p>
      <a className="btn" href={listo.link}>Abrir WhatsApp</a>
      <p><button className="sec" onClick={() => { setListo(null); setPaso("catalogo"); }}>Hacer otro pedido</button></p>
    </>
  );

  if (paso === "datos") {
    const ok = nombre.trim().length >= 2 && tel.replace(/\D/g, "").length >= 8 && (modalidad === "retiro" || dir.trim().length >= 3) && !bajoMinimo && !cerrado;
    return (
      <>
      {ventanaConfirmar}
        <button className="sec" onClick={() => setPaso("catalogo")}>← Seguir agregando</button>
        <h1>Tu pedido</h1>
        <div className="recibo">
        {items.map(({ p, cant }) => (
          <div className="row" key={p.id}>
            <span className="linea-nombre">{p.nombre}<br /><b>{peso(Number(p.precio) * cant)}</b></span>
            <div className="qty">
              <button className="sec" onClick={() => cambiar(p.id, -1)} aria-label={`Quitar uno de ${p.nombre}`}>−</button>
              <span>{cant}</span>
              <button onClick={() => cambiar(p.id, 1)} aria-label={`Agregar uno de ${p.nombre}`}>+</button>
            </div>
          </div>
        ))}
        {envio > 0 && <div className="row mut"><span>Envío</span><span>{peso(envio)}</span></div>}
        </div>
        <div className="total"><span>Total</span><b>{peso(total + envio)}</b></div>
        {bajoMinimo && <p role="alert" className="alerta">El pedido mínimo es {peso(minimo)}. Te faltan {peso(minimo - total)}.</p>}
        <label>Nombre<input value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="name" /></label>
        <label>Tu WhatsApp<input value={tel} onChange={(e) => setTel(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="Con código de área, sin 0 ni 15" /></label>
        <label>¿Cómo lo querés?
          <select value={modalidad} onChange={(e) => setModalidad(e.target.value as "retiro" | "envio")}>
            <option value="retiro">Retiro en el local</option>
            {kiosco.acepta_envio && <option value="envio">Envío</option>}
          </select>
        </label>
        {modalidad === "envio" && Number(kiosco.costo_envio) > 0 && <p className="mut">El envío cuesta {peso(Number(kiosco.costo_envio))}.</p>}
        {modalidad === "envio" && <label>Dirección<input value={dir} onChange={(e) => setDir(e.target.value)} autoComplete="street-address" /></label>}
        {(kiosco.medios_pago?.length ?? 0) > 1 && (
          <label>¿Cómo pagás?
            <select value={medio} onChange={(e) => setMedio(e.target.value)}>
              {kiosco.medios_pago.map((m) => <option key={m} value={m}>{ETIQUETA_PAGO[m] ?? m}</option>)}
            </select>
          </label>
        )}
        <label>Nota (opcional)<textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} /></label>
        {error && <p role="alert" className="alerta">{error}</p>}
        <button className="ancho" disabled={!ok || enviando} onClick={enviar}>{enviando ? "Enviando…" : "Enviar pedido por WhatsApp"}</button>
        <p className="mut">Usamos tu nombre y teléfono solo para gestionar este pedido con {kiosco.nombre}. <Link href="/privacidad">Política de privacidad</Link>.</p>
        <button className="sec" onClick={async () => { if (await confirmar({ titulo: "¿Vaciar el pedido?", confirmar: "Sí, seguir", peligro: true })) { setCart({}); setPaso("catalogo"); } }}>Vaciar pedido</button>
      </>
    );
  }

  return (
    <>
      <header className="afiche">
        <h1>{kiosco.nombre}<span className="punto">.</span></h1>
        {kiosco.direccion && <p>{kiosco.direccion}</p>}
        {horarioTexto && <p><span className="tag">Horario · {horarioTexto}</span></p>}
      </header>
      {cerrado && <div className="aviso-tienda" role="status"><b>{estado === "fuera_de_horario" ? "Fuera de horario" : "Cerrado por ahora"}</b>{proxima && <span> · {proxima}</span>}<p className="mut">Podés mirar los precios, pero no se reciben pedidos hasta que abra.</p></div>}
      {!cerrado && minimo > 0 && <p className="mut">Pedido mínimo: {peso(minimo)}</p>}
      {productos.length === 0 && <p className="mut">Este kiosco todavía no cargó productos.</p>}
      {productos.length > 0 && (
        <div className="sticky">
          <input type="search" placeholder="Buscar producto" value={q} onChange={(e) => setQ(e.target.value)} />
          {categorias.length > 1 && (
            <div className="chips">
              {["Todas", ...categorias].map((c) => (<button key={c} className={c === catSel ? "" : "sec"} onClick={() => setCatSel(c)}>{c}</button>))}
            </div>
          )}
        </div>
      )}
      {productos.length > 0 && porCategoria.length === 0 && <p className="mut">No encontramos nada con esa búsqueda.</p>}
      {porCategoria.map(([cat, ps]) => (
        <section key={cat}>
          <h2>{cat}</h2>
          <div className="grid-productos">
          {ps.map((p) => (
            <div className="producto" key={p.id}>
              <article className="card-producto">
                <div className="producto-img">
                  {p.imagen_url ? <img src={p.imagen_url} alt="" loading="lazy" /> : <span className="inicial" aria-hidden="true">{p.nombre.charAt(0).toUpperCase()}</span>}
                </div>
                <div className="producto-nombre">{p.nombre}</div>
                <div className="producto-pie">
                  <span className="producto-precio">{peso(Number(p.precio))}</span>
                  <div className="qty">
                    {cart[p.id] ? (<><button className="sec" onClick={() => cambiar(p.id, -1)} aria-label="Quitar uno">−</button><span>{cart[p.id]}</span></>) : null}
                    <button onClick={() => cambiar(p.id, 1)} aria-label={`Agregar ${p.nombre}`}>+</button>
                  </div>
                </div>
              </article>
            </div>
          ))}
          </div>
        </section>
      ))}
      {cantTotal > 0 && (
        <div className="bar"><div>
          <button className="ancho" disabled={cerrado || bajoMinimo} onClick={() => setPaso("datos")}>
            {cerrado ? "Local cerrado" : bajoMinimo ? `Faltan ${peso(minimo - total)} para el mínimo` : `Ver pedido (${cantTotal}) · ${peso(total)}`}
          </button>
        </div></div>
      )}
    </>
  );
}
