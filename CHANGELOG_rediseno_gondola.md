# Rediseño visual "Góndola" (reemplaza "Mercado Vivo")

Solo presentación. No se tocó lógica, datos ni consultas.

Archivos: app/globals.css (reescrito), app/layout.tsx, app/page.tsx, components/sellos/Campanas.tsx (se quitó un símbolo de texto).

- Identidad: rotulado de local de venta. Tinta casi negra, amarillo de etiqueta, gris hormigón. Sin crema, sin serif, sin terracota, sin fondo de puntos, sin degradados.
- Tipografía: Barlow Condensed (titulares y cifras grandes), IBM Plex Sans (interfaz), IBM Plex Mono (precios).
- Acción principal: etiqueta amarilla con borde de tinta y sombra de un solo sentido. Secundaria: contorno de tinta.
- Estados: sello de borde doble + palabra + color (nunca solo color).
- Portada: cinta de señalización al pie, muestra de pedido armada con CSS.
- Panel: menú lateral oscuro con marca amarilla en el ítem activo; barra inferior en celular.
- Accesibilidad mantenida: texto base 18 px, objetivos de 48 px, foco con doble anillo, sin mayúsculas sostenidas.
- Emojis: se quitaron también los que habían quedado en los componentes (carrito, caja, ccámara, regalo, etc.). Quedan solo símbolos de texto neutros (✔ ✕ ○) en listas y botones de cerrar. Se mantienen los 18 tests y typecheck limpio.
