import type { Metadata } from "next";
import Link from "next/link";
import { AvisoBorrador, Contacto, FECHA_LEGAL, Pie } from "@/components/Legal";

export const metadata: Metadata = { title: "Términos y condiciones · Pedí por WhatsApp" };

export default function Terminos() {
  return (
    <>
      <h1>Términos y condiciones</h1>
      <p className="mut">Última actualización: {FECHA_LEGAL}</p>
      <AvisoBorrador />

      <h2>1. Qué es Pedí por WhatsApp</h2>
      <p>Es una herramienta que permite a kioscos, almacenes y comercios de barrio (“el Comercio”) publicar un catálogo con una página propia y recibir pedidos de sus clientes por WhatsApp. También ofrece registros internos para el Comercio: pedidos, fiado y sellos de fidelidad. En estos términos, “nosotros” es el equipo que opera el servicio.</p>

      <h2>2. Quién es parte de cada compra</h2>
      <p>Somos solamente la herramienta. La compra es entre el cliente y el Comercio: el Comercio fija precios, disponibilidad, horarios, envíos y medios de pago, confirma o rechaza los pedidos y entrega los productos.</p>
      <p>No vendemos ni entregamos productos, no cobramos ni procesamos pagos, y no respondemos por los productos, los precios, las demoras ni el cumplimiento del Comercio. Un pedido enviado es una solicitud: la compra existe recién cuando el Comercio la confirma. Los derechos que la ley te reconoce como consumidor se mantienen frente al Comercio.</p>

      <h2>3. Cuenta del Comercio</h2>
      <p>Se accede con una cuenta de Google. Cada cuenta administra un local. Tenés que cargar datos verdaderos, mantenerlos actualizados y cuidar el acceso a tu cuenta.</p>
      <p>Sos responsable de lo que publicás (nombres, precios, fotos, horarios) y de que no infrinja derechos de terceros. Sos responsable también de cumplir la normativa que te alcanza como comerciante: habilitaciones, obligaciones fiscales y las reglas de venta de productos regulados, como alcohol y tabaco, que no pueden venderse a menores de edad.</p>

      <h2>4. Fiado y sellos</h2>
      <p>El fiado y los sellos son herramientas de anotación para el Comercio. No son un servicio financiero, un crédito ni un medio de pago, y no intervenimos en el cobro de esas deudas.</p>
      <p>El Comercio es responsable de los datos de sus clientes que carga y debe usarlos solo para atender su comercio, respetando la <Link href="/privacidad">Política de privacidad</Link>. Los recordatorios que envía por WhatsApp salen de su propio teléfono y no deben usarse para enviar mensajes no deseados.</p>

      <h2>5. Usos no permitidos</h2>
      <p>No podés usar el servicio para actividades ilegales, para enviar spam, para suplantar a otra persona, para intentar acceder a datos de otros comercios ni para vulnerar o sobrecargar el sistema. El servicio tiene límites de pedidos por teléfono y por local para evitar abusos.</p>

      <h2>6. Contenido y datos</h2>
      <p>Los datos y contenidos que cargás siguen siendo tuyos. Nos autorizás a almacenarlos y mostrarlos solo para prestar el servicio. Las fotos de producto que subas se ven públicamente en la tienda de tu local.</p>
      <p>Cuando cargás un producto con código de barras, el nombre puede aportarse a una base compartida entre comercios. Se publica para otros únicamente cuando coincide con lo aportado por otro comercio, y no contiene datos personales.</p>

      <h2>7. Disponibilidad</h2>
      <p>El servicio se ofrece en su estado actual y está en etapa temprana: puede haber interrupciones, errores o cambios. Hacemos lo razonable para que funcione bien, pero no garantizamos que esté disponible de forma ininterrumpida. En la medida que la ley lo permita, no respondemos por daños indirectos ni por pedidos o ventas perdidos por una interrupción.</p>

      <h2>8. Costo</h2>
      <p>Durante la etapa de prueba el servicio no tiene costo. Si en el futuro se cobra, lo vamos a avisar con anticipación para que puedas decidir si seguir usándolo.</p>

      <h2>9. Baja y suspensión</h2>
      <p>Podés dejar de usar el servicio cuando quieras y pedir que eliminemos tu cuenta y tus datos. Podemos suspender cuentas que incumplan estos términos.</p>

      <h2>10. Cambios</h2>
      <p>Podemos actualizar estos términos. Los cambios importantes los avisamos en el panel. Si seguís usando el servicio después del aviso, se entiende que los aceptás.</p>

      <h2>11. Ley aplicable</h2>
      <p>Estos términos se rigen por las leyes de la República Argentina. Para cualquier conflicto serán competentes los tribunales ordinarios que correspondan, sin perjuicio de los derechos que la ley reconoce a los consumidores.</p>

      <h2>12. Contacto</h2>
      <p>Consultas sobre estos términos: <Contacto />.</p>
      <Pie />
    </>
  );
}
