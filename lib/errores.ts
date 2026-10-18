// Mensajes amigables para los códigos que las funciones SQL lanzan con "raise exception 'codigo'".
// Cada código de las migraciones tiene que estar acá o en la lista de su módulo (lo verifica tests/errores.test.mjs).
export const ERRORES_SQL: [string, string][] = [
  ["baja_fuera_de_orden", "Para dar de baja vencidos, primero descontá el lote que vence antes."],
  ["cantidad_mayor_al_lote", "La cantidad es mayor a lo que queda en ese lote."],
  ["lote_mayor_al_stock", "El lote no puede tener más unidades que el stock del producto."],
  ["vencimiento_invalido", "La fecha de vencimiento no es válida."],
  ["minimo_compras_invalido", "El mínimo de compras tiene que estar entre 1 y 100."],
  ["dias_invalidos", "Los días no son válidos. Revisá el rango permitido."],
  ["tipo_regla_invalido", "Ese tipo de aviso no existe."],
  ["umbral_invalido", "El umbral tiene que ser mayor a cero."],
  ["canal_invalido", "Ese canal de aviso no es válido."],
  ["categoria_requerida", "Elegí una categoría para el conteo."],
  ["codigo_invalido", "El código no es válido."],
  ["conteo_cerrado", "Ese conteo ya está cerrado."],
  ["conteo_en_curso", "Ya hay un conteo en curso. Terminalo o descartalo antes de empezar otro."],
  ["criterio_invalido", "Ese criterio de conteo no es válido."],
  ["demasiados_aportes", "Hiciste demasiados aportes seguidos. Probá más tarde."],
  ["estado_invalido", "Ese estado de pedido no es válido."],
  ["margen_invalido", "El margen no es válido. Revisá el porcentaje."],
  ["opcion_invalida", "Esa opción no es válida."],
  ["pagos_invalidos", "Los pagos no coinciden con el total de la venta."],
  ["porcentaje_invalido", "El porcentaje está fuera de rango."],
  ["redondeo_invalido", "Ese redondeo no es válido."],
  ["sin_cliente", "Elegí un cliente para esta operación."],
  ["sin_productos", "No hay productos para contar en esa categoría."],
  ["ya_revertido", "Esa operación ya fue revertida."],
];

/** Traduce el mensaje de error de Supabase/Postgres a un texto para el dueño. Si no se reconoce, devuelve un texto genérico. */
export const mensajeErrorSql = (m: string, extra: [string, string][] = []) =>
  [...extra, ...ERRORES_SQL].find(([k]) => m.includes(k))?.[1] ?? "No se pudo completar la operación.";
