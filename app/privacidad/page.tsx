import type { Metadata } from "next";
import Link from "next/link";
import { AvisoBorrador, Contacto, FECHA_LEGAL, Pie } from "@/components/Legal";

export const metadata: Metadata = { title: "Política de privacidad · Pedí por WhatsApp" };

export default function Privacidad() {
  return (
    <>
      <h1>Política de privacidad</h1>
      <p className="mut">Última actualización: {FECHA_LEGAL}</p>
      <AvisoBorrador />

      <h2>1. Quién usa tus datos</h2>
      <p><b>Si hacés un pedido</b>, quien decide para qué se usan tus datos es el comercio al que le pedís. Nosotros somos el proveedor tecnológico que los almacena y procesa por cuenta de ese comercio.</p>
      <p><b>Si sos un comercio</b> que usa el panel, nosotros somos responsables de los datos de tu cuenta.</p>

      <h2>2. Qué datos tratamos</h2>
      <p><b>De quien hace un pedido:</b> nombre, teléfono de WhatsApp, dirección (solo si elegís envío), el contenido del pedido (productos, cantidades, total y medio de pago elegido), las notas que escribas, y la fecha y el estado del pedido.</p>
      <p><b>En la libreta del comercio:</b> los movimientos de fiado y pagos, y los sellos de fidelidad asociados a un cliente.</p>
      <p><b>Del comercio:</b> el email y el nombre de su cuenta de Google (por el inicio de sesión) y los datos del local: nombre, dirección, WhatsApp, horarios, productos, precios y fotos.</p>
      <p><b>Técnicos:</b> dirección IP y datos básicos del dispositivo, que quedan en los registros de los proveedores de infraestructura.</p>
      <p>No pedimos datos de tarjetas ni procesamos pagos. No pedimos datos sensibles.</p>

      <h2>3. Para qué los usamos</h2>
      <p>Para gestionar tu pedido y comunicarnos con vos sobre él; para que el comercio lleve su registro de pedidos, fiado y sellos; para prevenir abusos (por ejemplo, limitando la cantidad de pedidos por teléfono) y para mantener y mejorar el servicio. No vendemos tus datos ni mostramos publicidad de terceros.</p>

      <h2>4. Con quién se comparten</h2>
      <p>Con el <b>comercio</b> al que le hacés el pedido, que recibe tu nombre, teléfono, dirección (si hay envío) y el detalle del pedido.</p>
      <p>Con <b>WhatsApp (Meta)</b>: el pedido se envía desde tu propio WhatsApp al número del comercio, y ese envío se rige por los términos de WhatsApp.</p>
      <p>Con <b>proveedores de infraestructura</b> que nos permiten operar: Supabase (base de datos, autenticación y almacenamiento de fotos), Vercel (alojamiento de la aplicación) y Google (inicio de sesión del comercio). Para completar datos de productos consultamos Open Food Facts enviando solamente el código de barras, sin datos personales.</p>
      <p>Con <b>autoridades</b>, cuando una ley o una orden judicial lo exija.</p>
      <p>Los servidores de estos proveedores pueden estar ubicados fuera de la Argentina, por lo que tus datos pueden almacenarse en otros países. Al hacer un pedido o usar el servicio, aceptás esa transferencia.</p>

      <h2>5. Datos guardados en tu dispositivo</h2>
      <p>Para que no tengas que volver a cargarlos, guardamos en tu navegador (almacenamiento local) tu carrito y tus datos de contacto. Podés borrarlos desde los ajustes del navegador. El panel del comercio guarda la sesión iniciada. No usamos cookies de publicidad ni de seguimiento.</p>

      <h2>6. Cuánto tiempo los conservamos</h2>
      <p>Mientras el comercio use el servicio, o hasta que se pida la supresión de los datos. Si cerrás tu cuenta de comercio, podés pedirnos que eliminemos tus datos y los de tu local.</p>

      <h2>7. Tus derechos</h2>
      <p>Según la Ley 25.326 de Protección de los Datos Personales, tenés derecho a acceder a tus datos, rectificarlos, actualizarlos y pedir su supresión. El acceso es gratuito y puede ejercerse en intervalos no inferiores a seis meses, salvo que acredites un interés legítimo.</p>
      <p>Para ejercerlos, escribile al comercio al que le pediste, o escribinos a <Contacto />. Indicá tu nombre y el teléfono con el que hiciste el pedido para que podamos ubicar tus datos.</p>
      <p>La Agencia de Acceso a la Información Pública, en su carácter de Órgano de Control de la Ley 25.326, tiene la atribución de atender las denuncias y reclamos que se interpongan con relación al incumplimiento de las normas sobre protección de datos personales.</p>

      <h2>8. Seguridad</h2>
      <p>Usamos conexión cifrada (HTTPS) y controles de acceso para que cada comercio vea únicamente sus propios pedidos y clientes. Ningún sistema es completamente seguro, pero trabajamos para proteger tus datos.</p>

      <h2>9. Cambios</h2>
      <p>Podemos actualizar esta política. Publicaremos la versión vigente en esta página con su fecha. Los <Link href="/terminos">Términos y condiciones</Link> también se aplican al uso del servicio.</p>

      <h2>10. Contacto</h2>
      <p>Consultas sobre privacidad: <Contacto />.</p>
      <Pie />
    </>
  );
}
