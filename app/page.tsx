import Link from "next/link";
import AyudaWhatsApp from "@/components/AyudaWhatsApp";

const PILARES = [
  {
    t: "Pedidos por WhatsApp, con tu catálogo siempre al día",
    d: "Tus clientes eligen desde el celular y vos recibís el pedido armado en tu WhatsApp. La tienda se arma con los mismos productos y precios que tenés cargados: cambiás un precio una vez y se actualiza en todos lados.",
    p: ["Tienda propia con un QR para pegar en el local", "Catálogo, precios y stock sincronizados", "Confirmás con un toque"],
  },
  {
    t: "Puntos que se canjean por premios",
    d: "Cada compra suma puntos y tus clientes los cambian por los premios que vos elegís. Es la razón para que vuelvan a tu kiosco y no al de la esquina.",
    p: ["Armás tus premios y cuántos puntos valen", "Tus clientes ven sus puntos en su tarjeta", "Sabés quiénes vuelven y qué canjean"],
  },
];
const PASOS = [
  { n: "1", t: "Cargás tus productos una sola vez", d: "Con nombre, precio y foto. Si ya tenés una lista, la subís de una vez. Ese catálogo alimenta la tienda y la caja." },
  { n: "2", t: "Pegás el QR en el local", d: "Tus clientes lo escanean con el celular y piden desde tu tienda, sin instalar nada." },
  { n: "3", t: "Recibís el pedido y ellos suman puntos", d: "Te llega el pedido armado en WhatsApp. Cada compra les suma puntos para canjear por premios." },
];
const ADEMAS = [
  ["Punto de venta", "Cobrá en el mostrador, hacé el cierre del día y llevá la plata ordenada."],
  ["Facturación electrónica", "Emití Factura C desde la caja, con comprobante en PDF y QR de ARCA."],
  ["Fiado", "Anotá quién te debe y cuánto, y recordáselo por WhatsApp."],
];

export default function Home() {
  return (
    <>
      <header className="afiche portada">
        <div>
          <h1>Tu kiosco en <mark>WhatsApp</mark></h1>
          <p>Tus clientes piden desde un catálogo siempre actualizado y suman puntos para canjear por premios.</p>
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
          <div className="muestra-pts"><span>Puntos de esta compra</span><b>+68</b></div>
          <div className="muestra-tot"><span>Total</span><b>$ 6.800</b></div>
          <p className="muestra-pie">Te llega por WhatsApp, listo para confirmar</p>
        </figure>
      </header>

      <section className="portada-sec" aria-labelledby="distinto">
        <h2 id="distinto">Lo que hace distinto a tu kiosco</h2>
        <div className="pilares">
          {PILARES.map((p) => (
            <article key={p.t} className="card pilar">
              <h3>{p.t}</h3>
              <p>{p.d}</p>
              <ul>{p.p.map((x) => <li key={x}>{x}</li>)}</ul>
            </article>
          ))}
        </div>
      </section>

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

      <section className="portada-sec" aria-labelledby="ademas">
        <h2 id="ademas">Y además, para el mostrador</h2>
        <ul className="incluye incluye-3">
          {ADEMAS.map(([t, d]) => (
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
