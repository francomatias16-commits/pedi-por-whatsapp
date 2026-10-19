# Etapa 2A: cajeros y roles

Cada persona del local entra con su propia cuenta de Google y ve solo lo que le toca. Ventas, anulaciones y devoluciones registran quién las hizo (`usuario_id`).

## Roles
| Rol | Puede |
|---|---|
| Cajero | Abrir y cerrar caja, vender y cobrar, ver y confirmar pedidos, anotar fiado y puntos en la venta, ver el reporte Z de su turno. |
| Encargado | Además: productos, precios, stock, conteos, compras, proveedores, fidelidad, reportes y "Cómo me fue". |
| Dueño | Todo, incluido Mi negocio, cobros con Mercado Pago, PIN de supervisor, exportar y dar de baja los datos, y el equipo. |

El dueño de la cuenta es siempre `kioscos.owner_id` y siempre tiene rol `dueno`, exista o no su fila en `kiosco_miembros`.

## Cómo funciona
1. El dueño va a Mi negocio > Mi equipo, elige el rol y crea un enlace. El enlace se muestra **una sola vez**; en la base queda solo su huella (SHA-256). Sirve una vez y vence a los 7 días. Máximo 20 invitaciones sin usar y 30 personas por local.
2. La persona abre `/unirse/<token>`, entra con Google, ve "Te invitaron a X como cajero" y acepta. Si no tenía sesión, el panel la trae de vuelta a la invitación (se recuerda en `localStorage`; Google siempre vuelve a `/panel`, así que **no hace falta tocar las URL permitidas de Supabase Auth**).
3. Una cuenta puede estar en **un solo local a la vez** (índice único sobre membresías activas). Quitar a alguien le corta el acceso en el acto; puede volver con una invitación nueva.
4. El menú se filtra por rol (`lib/navegacion.ts`): el cajero solo ve Vender, Pedidos y Clientes > Fiado y entra directo a la caja. Es comodidad: **la base es la que manda** (RLS y RPC).

## Cómo se aplicó la matriz (migración 0030)
- `es_dueno()` no cambia. Se agregan `rol_en(kiosco)` y `es_miembro(kiosco, roles[])`.
- La matriz de la migración reescribe **por catálogo** 37 políticas y 54 funciones (`es_dueno(x)` pasa a `es_miembro(x, roles)`), y **falla el despliegue** si alguna no existe o no usa `es_dueno()`. Lo que no figura en la matriz queda solo para el dueño (falla cerrado): `mp_*`, `pos_pin_definir/quitar/opciones`, `kiosco_*` (baja y exportación), `equipo_*`.
- `pos_config` guarda el hash del PIN: sigue solo para el dueño. Caja lee la configuración por `pos_config_publica()`, sin secretos.
- Anular o devolver: el cajero **siempre** necesita un PIN de supervisor vigente, aunque el local tenga esa opción apagada, y si el local no tiene PIN no puede (`supervisor_requerido`). Encargado y dueño siguen la regla de siempre.
- Restricciones extra para el cajero: no borra pedidos ni clientes, y no corrige ni borra fiado ya anotado.
- Fotos de productos: suben el dueño y el encargado.

## Decisiones que tomé (revisalas)
- **Cajero anula con PIN de supervisor**, nunca solo (decisión pendiente del plan: "con PIN o sin él").
- El cajero ve el **reporte Z de su turno** porque lo necesita para cerrar la caja.
- El encargado ve **Mi negocio solo con "Cómo me fue"** (sin datos del local, pagos ni equipo).
- La tienda abierta/cerrada la cambia solo el dueño (el botón queda visible pero bloqueado).
- El cajero no ve **Puntos** como pantalla de administración; da puntos desde la venta.

## Limitaciones conocidas
- Los avisos push van a todos los dispositivos suscriptos del local (también los de alertas de reposición, fiado y fuga). El botón para activarlos está en Mi negocio, así que **un cajero hoy no puede activarlos**.
- Sin deshacer rápido de un rol quitado por error: hay que volver a invitar.
- No se probó con Supabase real ni en celular; la prueba SQL usa un `auth` simulado.

## Checklist de aceptación
- [ ] Backup, aplicar **0030** en el SQL Editor (después de 0029) y verificar que corre sin errores `matriz: …`.
- [ ] Desplegar el código y probar en preview.
- [ ] Con tu cuenta (dueño): Mi negocio > Mi equipo aparece y vos figurás como Dueño.
- [ ] Invitar a una segunda cuenta de Google como cajero: abre el enlace, ve el local, acepta y cae en la caja.
- [ ] El cajero vende, cierra caja y ve pedidos y fiado; no ve Productos, Compras ni Mi negocio (ni escribiendo la dirección a mano).
- [ ] El cajero intenta anular una venta: pide PIN; sin PIN configurado, avisa que falta.
- [ ] El enlace usado, cancelado o vencido muestra el mensaje de invitación inválida.
- [ ] Cambiar el rol a encargado: ve Productos y Compras sin recargar sesión; quitarlo: pierde acceso al instante.
- [ ] Las ventas nuevas quedan con el usuario correcto (`ventas_mostrador.usuario_id`).
- [ ] Un local ajeno no se ve afectado.
