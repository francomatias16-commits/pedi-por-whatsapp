import Link from "next/link";
import AyudaWhatsApp from "@/components/AyudaWhatsApp";

const PASOS = [
  { n: "1", t: "Cargás tus productos", d: "Con nombre, precio y foto. Si ya tenés una lista, la subís de una vez." },
  { n: "2", t: "Pegás el QR en el local", d: "Tus clientes lo escanean con el celular y ven tu tienda, sin instalar nada." },
  { n: "3", t: "Recibís los pedidos en WhatsApp", d: "Te llega el pedido armado. Confirmás con un toque y listo." },
];
const INCLUYE = [
  ["Tienda propia", "Tus productos y precios, siempre al día."],
  ["Caja para el mostrador", "Cobrá, hacé el cierre del día y llevá la plata ordenada."],
  ["Fiado", "Anotá quién te debe y cuánto, y recordáselo por WhatsApp."],
  ["Puntos y premios", "Tus clientes suman puntos con cada compra y vuelven."],
];

export default function Home() {
  return (
    <>
      <header className="afiche portada">
        <div>
          <h1>Tu kiosco en <mark>WhatsApp</mark></h1>
          <p>Tus clientes piden desde el celular y vos recibís el pedido listo en tu WhatsApp.</p>
          <p style={{ marginTop: "1.25rem" }}>
            <Link className="btn btn-grande" href="/panel">Entrar a mi kiosco</Link>
          </p>
        </div>
        <figure className="muestra" aria-label="Ejemplo de un pedido recibido">
          <div className="muestra-cab"><span>Pedido de Marcela</span><b>Ejemplo</b></div>
          <ul>
            <li><span>2 × Alfajor triple</span><span>3.200</span></li>
            <li><span>1 × Gaseosa 1,5 L</span><span>2.100</span></li>
            <li><span>3 × Chicle menta</span><span>1.500</span></li>
          </ul>
          <div className="muestra-tot"><span>Total</span><b>$ 6.800</b></div>
          <p className="muestra-pie">Te llega por WhatsApp, listo para confirmar</p>
        </figure>
      </header>

      <section className="portada-sec" aria-labelledby="como">
        <h2 id="como">Cómo funciona</h2>
        <ol className="pasos">
          {PASOS.map((p) => (
            <li key={p.n} className="card paso">
              <span className="paso-n" aria-hidden="true">{p.n}</span>
              <div><b>{p.t}</b><p className="mut">{p.d}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="portada-sec" aria-labelledby="incluye">
        <h2 id="incluye">Todo lo que necesitás, en un solo lugar</h2>
        <ul className="incluye">
          {INCLUYE.map(([t, d]) => (
            <li key={t}><b>{t}</b><span className="mut">{d}</span></li>
          ))}
        </ul>
      </section>

      <section className="portada-cierre">
        <Link className="btn btn-grande" href="/panel">Entrar a mi kiosco</Link>
        <AyudaWhatsApp />
      </section>
    </>
  );
}
