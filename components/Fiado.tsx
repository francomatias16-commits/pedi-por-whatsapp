"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import { linkWhatsApp, normalizarTelefonoAR, peso } from "@/lib/whatsapp";
import Pantalla from "@/components/ui/Pantalla";
import Aviso from "@/components/ui/Aviso";
import EstadoVacio from "@/components/ui/EstadoVacio";
import Esqueleto from "@/components/ui/Esqueleto";
import { useConfirmar } from "@/components/ui/Confirmar";

type Cli = { id: string; nombre: string; telefono: string; saldo: number; ultimo_movimiento: string | null };
type Mov = { id: string; tipo: "fiado" | "pago"; monto: number; created_at: string; nota: string | null };
const num = (s: string) => Number(s.replace(",", "."));

// "Quién me debe": la libreta de clientes que compran a fiado. Cobrar = registrar un pago.
export default function Fiado({ kiosco }: { kiosco: Kiosco }) {
  const [lista, setLista] = useState<Cli[]>([]);
  const [cargado, setCargado] = useState(false);
  const [soloDeuda, setSoloDeuda] = useState(true);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [movs, setMovs] = useState<Mov[]>([]);
  const [monto, setMonto] = useState("");
  const [nNombre, setNNombre] = useState(""); const [nTel, setNTel] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState(false);
  const [ventanaConfirmar, confirmar] = useConfirmar();

  const cargar = useCallback(async () => {
    const { data, error: err } = await supabase.from("clientes_saldo").select("*").eq("kiosco_id", kiosco.id).order("saldo", { ascending: false }).order("nombre");
    if (err) { setError(true); setMsg("No pudimos cargar la libreta. Revisá la conexión."); }
    else { setError(false); setLista((data ?? []).map((c) => ({ ...c, saldo: Number(c.saldo) })) as Cli[]); }
    setCargado(true);
  }, [kiosco.id]);
  useEffect(() => { cargar(); }, [cargar]);

  async function abrir(id: string) {
    setMonto(""); setMsg("");
    if (abierto === id) { setAbierto(null); return; }
    setAbierto(id);
    const { data } = await supabase.from("fiado_movimientos").select("id,tipo,monto,created_at,nota").eq("cliente_id", id).order("created_at", { ascending: false }).limit(10);
    setMovs((data ?? []) as Mov[]);
  }

  async function registrar(c: Cli, tipo: "fiado" | "pago") {
    const m = num(monto);
    if (!(m > 0)) { setMsg("Poné un monto mayor a cero."); return; }
    const { error: err } = await supabase.from("fiado_movimientos").insert({ kiosco_id: kiosco.id, cliente_id: c.id, tipo, monto: m });
    if (err) { setMsg("No se pudo guardar. Probá de nuevo."); return; }
    setMonto(""); setMsg(tipo === "fiado" ? "Anotado" : "Pago cobrado");
    await cargar();
    const { data } = await supabase.from("fiado_movimientos").select("id,tipo,monto,created_at,nota").eq("cliente_id", c.id).order("created_at", { ascending: false }).limit(10);
    setMovs((data ?? []) as Mov[]);
  }

  async function nuevo() {
    const { error: err } = await supabase.from("clientes").insert({ kiosco_id: kiosco.id, nombre: nNombre.trim(), telefono: normalizarTelefonoAR(nTel) });
    if (err) { setMsg(err.code === "23505" ? "Ya tenés un cliente con ese teléfono." : "No se pudo crear el cliente."); return; }
    setNNombre(""); setNTel(""); setSoloDeuda(false); setMsg("Cliente creado"); cargar();
  }

  async function borrar(c: Cli) {
    if (!(await confirmar({ titulo: `¿Borrar a ${c.nombre} de la libreta?`, detalle: "Se pierden su fiado, sus puntos y su historial. Los pedidos se conservan.", confirmar: "Sí, borrar cliente", peligro: true }))) return;
    const { error: err } = await supabase.rpc("borrar_cliente", { p_cliente: c.id });
    if (err) { setMsg("No se pudo borrar el cliente."); return; }
    setAbierto(null); setMsg("Cliente borrado");
    await cargar();
  }

  const deuda = lista.filter((c) => c.saldo > 0).reduce((s, c) => s + c.saldo, 0);
  const conDeuda = lista.filter((c) => c.saldo > 0).length;
  const visibles = soloDeuda ? lista.filter((c) => c.saldo > 0) : lista;
  return (
    <Pantalla titulo="Quién me debe" ayuda="Acá anotás lo que tus clientes se llevan a fiado y lo que te pagan. Tocá un nombre para ver su cuenta.">
      {ventanaConfirmar}
      <div className="card" style={{ textAlign: "center" }}>
        <div className="mut">Te deben en total</div>
        <b style={{ fontSize: 28 }}>{peso(deuda)}</b>
        <div className="mut">{conDeuda} cliente{conDeuda === 1 ? "" : "s"} con saldo</div>
      </div>
      <label className="mut" style={{ display: "block", margin: "8px 0" }}>
        <input type="checkbox" checked={soloDeuda} onChange={(e) => setSoloDeuda(e.target.checked)} style={{ width: "auto", marginRight: 8 }} />Mostrar solo quienes deben
      </label>
      {error && <Aviso tipo="error">{msg}</Aviso>}
      {!error && msg && <Aviso tipo="ok">{msg}</Aviso>}
      {!cargado && <Esqueleto lineas={3} />}
      {cargado && visibles.length === 0 && (
        soloDeuda
          ? <EstadoVacio titulo="Nadie te debe nada">Cuando un cliente se lleve algo a fiado, lo vas a ver acá.</EstadoVacio>
          : <EstadoVacio titulo="Todavía no cargaste clientes">Agregá el primero abajo, en “Nuevo cliente”.</EstadoVacio>
      )}
      {visibles.map((c) => (
        <div className="card" key={c.id}>
          <button type="button" className="fila-toggle" aria-expanded={abierto === c.id} onClick={() => abrir(c.id)}>
            <span>{c.nombre}</span>
            <b style={{ color: c.saldo > 0 ? "var(--danger)" : undefined }}>{peso(c.saldo)}</b>
          </button>
          {abierto === c.id && (
            <>
              <label style={{ display: "block", marginTop: 10 }}>Monto
                <input value={monto} onChange={(e) => setMonto(e.target.value)} inputMode="decimal" placeholder="Ej: 1500" />
              </label>
              <div className="row" style={{ justifyContent: "flex-start", flexWrap: "wrap", marginTop: 8 }}>
                <button className="principal" onClick={() => registrar(c, "pago")}>Cobrar</button>
                <button className="sec" onClick={() => registrar(c, "fiado")}>Anotar fiado</button>
                {c.saldo > 0 && (
                  <a className="btn sec" href={linkWhatsApp(normalizarTelefonoAR(c.telefono),
                    `Hola ${c.nombre}! Te escribimos de ${kiosco.nombre}. Te recordamos que tenés un saldo pendiente de ${peso(c.saldo)}. Cuando puedas pasá a saldarlo. ¡Gracias!`)}>Recordarle por WhatsApp</a>
                )}
                <button className="sec" onClick={() => borrar(c)} style={{ color: "var(--danger)" }}>Borrar cliente</button>
              </div>
              <ul style={{ margin: "10px 0 0", paddingLeft: 20 }} className="mut">
                {movs.map((m) => (<li key={m.id}>{new Date(m.created_at).toLocaleDateString("es-AR")} · {m.tipo === "fiado" ? "se llevó" : "pagó"} {peso(Number(m.monto))}{m.nota ? ` · ${m.nota}` : ""}</li>))}
                {movs.length === 0 && <li>Sin movimientos todavía.</li>}
              </ul>
            </>
          )}
        </div>
      ))}
      <h3>Nuevo cliente</h3>
      <label style={{ display: "block" }}>Nombre
        <input value={nNombre} onChange={(e) => setNNombre(e.target.value)} placeholder="Ej: María Gómez" />
      </label>
      <label style={{ display: "block", marginTop: 8 }}>WhatsApp
        <input value={nTel} onChange={(e) => setNTel(e.target.value)} inputMode="tel" placeholder="Ej: 11 5555-5555" />
      </label>
      <button disabled={nNombre.trim().length < 2 || nTel.replace(/\D/g, "").length < 8} onClick={nuevo} style={{ marginTop: 8 }}>Guardar cliente</button>
    </Pantalla>
  );
}
