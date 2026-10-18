// Aviso semanal de clientes que dejaron de venir (lo manda el cron, solo al dueño; nunca a los clientes).
export function armarAvisoFuga(a: { clientes: number; dias: number }) {
  const n = a.clientes;
  return {
    title: "Clientes que dejaron de venir",
    body: `${n} cliente${n > 1 ? "s" : ""} no compra${n > 1 ? "n" : ""} hace más de ${a.dias} días`,
    url: "/panel?tab=radar",
  };
}
