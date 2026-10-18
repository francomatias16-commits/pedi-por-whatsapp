"use client";
import { useState } from "react";
import { supabase, type Kiosco } from "@/lib/supabase";
import {
  CAMPANA_VACIA, PREMIO_VACIO, campanaDesdeForm, describirCampana, describirPremio, mensajeFidelidad, premioDesdeForm,
  validarCampana, validarPremio, type Campana, type FormCampana, type FormPremio, type Premio,
} from "@/lib/fidelidad";
import Aviso from "@/components/ui/Aviso";

// Opciones de "¿cuándo suma puntos?": cada una arma una campaña con valores sensatos.
const OPCIONES: { id: "compra" | "monto" | "doble"; titulo: string; ayuda: string; form: Partial<FormCampana> }[] = [
  { id: "compra", titulo: "Por cada compra", ayuda: "1 punto cada vez que compra, en el mostrador o por pedido.", form: { nombre: "Puntos por compra", tipo: "visita", sellos: "1" } },
  { id: "monto", titulo: "Por cada monto gastado", ayuda: "1 punto cada $1.000 que gasta.", form: { nombre: "Puntos por monto", tipo: "monto", sellos: "1", por_monto: "1000" } },
  { id: "doble", titulo: "Doble los martes", ayuda: "Los martes suma el doble. Podés cambiar el día después en “Cómo se suman”.", form: { nombre: "Martes de puntos dobles", tipo: "multiplicador", multiplicador: "2", dias_semana: [2] } },
];

// Asistente en 3 pasos: ¿cuándo suma puntos? → ¿qué premio ofrecés? → ver un ejemplo y guardar.
export default function Asistente({ kiosco, onListo, onCancelar }: { kiosco: Kiosco; onListo: () => void; onCancelar: () => void }) {
  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  const [opcion, setOpcion] = useState<typeof OPCIONES[number] | null>(null);
  const [premio, setPremio] = useState<FormPremio>({ ...PREMIO_VACIO, nombre: "Café con medialuna", costo_sellos: "10" });
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const campanaForm: FormCampana | null = opcion ? { ...CAMPANA_VACIA, ...opcion.form } : null;
  const filaCampana = campanaForm ? campanaDesdeForm(campanaForm) : null;

  function siguiente() {
    setMsg("");
    if (paso === 1) {
      if (!opcion) return setMsg("Elegí cómo suman puntos.");
      return setPaso(2);
    }
    if (paso === 2) {
      const err = validarPremio(premio);
      if (err) return setMsg(err);
      return setPaso(3);
    }
  }

  async function guardar() {
    if (!campanaForm || !filaCampana) return;
    const errC = validarCampana(campanaForm); if (errC) return setMsg(errC);
    const errP = validarPremio(premio); if (errP) return setMsg(errP);
    setOcupado(true); setMsg("");
    const { error: e1 } = await supabase.from("fidelidad_campanas").insert({ ...filaCampana, kiosco_id: kiosco.id });
    if (e1) { setOcupado(false); return setMsg(mensajeFidelidad(e1.message)); }
    const { error: e2 } = await supabase.from("fidelidad_premios").insert({ ...premioDesdeForm(premio), kiosco_id: kiosco.id });
    setOcupado(false);
    if (e2) return setMsg(`La campaña se guardó, pero el premio no: ${mensajeFidelidad(e2.message)}`);
    onListo();
  }

  const ejemploCampana = filaCampana ? describirCampana({ id: "", activa: true, ...filaCampana } as unknown as Campana) : "";
  const ejemploPremio = describirPremio({ id: "", activo: true, ...premioDesdeForm(premio) } as unknown as Premio);

  return (
    <div className="card asistente">
      <h3>Armá tu programa en 3 pasos</h3>
      <div className="pasos" role="list" aria-label="Pasos">
        {["¿Cuándo suma?", "¿Qué premio?", "Ver y guardar"].map((t, i) => (
          <span key={t} role="listitem" className={`paso${paso === i + 1 ? " on" : paso > i + 1 ? " hecho" : ""}`} aria-current={paso === i + 1 ? "step" : undefined}>
            <b>{i + 1}</b> {t}
          </span>
        ))}
      </div>

      {paso === 1 && (
        <>
          <p className="mut">¿Cómo querés que tus clientes sumen puntos?</p>
          <div className="opciones" role="radiogroup" aria-label="Cuándo suman puntos">
            {OPCIONES.map((o) => (
              <button key={o.id} type="button" role="radio" aria-checked={opcion?.id === o.id} className={`opcion${opcion?.id === o.id ? " on" : ""}`} onClick={() => setOpcion(o)}>
                <b>{o.titulo}</b><small>{o.ayuda}</small>
              </button>
            ))}
          </div>
        </>
      )}

      {paso === 2 && (
        <>
          <p className="mut">¿Qué premio ofrecés cuando junten puntos?</p>
          <label>Premio<input value={premio.nombre} maxLength={80} placeholder="Ej: Café con medialuna" onChange={(e) => setPremio({ ...premio, nombre: e.target.value })} /></label>
          <label style={{ marginTop: 10 }}>Cuántos puntos cuesta<input inputMode="numeric" value={premio.costo_sellos} onChange={(e) => setPremio({ ...premio, costo_sellos: e.target.value })} /></label>
          <p className="mut" style={{ marginTop: 6 }}>Lo entregás a mano en el mostrador. Después podés agregar más premios, con descuento o producto gratis.</p>
        </>
      )}

      {paso === 3 && (
        <>
          <p className="mut">Así va a quedar. Si algo no te cierra, volvé y cambialo.</p>
          <div className="ejemplo">
            <p><b>Cómo suman:</b> {ejemploCampana}</p>
            <p><b>Premio:</b> {ejemploPremio}</p>
            <p className="mut">Ejemplo: si un cliente compra {Math.max(1, Math.ceil(Number(premio.costo_sellos) || 10))} veces, se lleva el premio.</p>
          </div>
        </>
      )}

      {msg && <Aviso tipo="error">{msg}</Aviso>}

      <div className="acciones" style={{ marginTop: 12, flexWrap: "wrap" }}>
        {paso === 1 ? <button type="button" className="sec" onClick={onCancelar}>Cancelar</button> : <button type="button" className="sec" onClick={() => setPaso((paso - 1) as 1 | 2)}>Volver</button>}
        {paso < 3 && <button type="button" className="principal" onClick={siguiente}>Seguir</button>}
        {paso === 3 && <button type="button" className="principal" disabled={ocupado} onClick={guardar}>{ocupado ? "Guardando…" : "Guardar mi programa"}</button>}
      </div>
    </div>
  );
}
