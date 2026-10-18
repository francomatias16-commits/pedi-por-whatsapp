// Aviso semanal de fiado vencido (lo manda el cron, solo al dueño; nunca a los clientes).
export function armarAvisoFiado(a: { clientes: number; monto: number; dias: number }) {
  const plata = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(Math.round(a.monto));
  return {
    title: "Fiado para cobrar",
    body: `${a.clientes} cliente${a.clientes > 1 ? "s" : ""} debe${a.clientes > 1 ? "n" : ""} $${plata} hace más de ${a.dias} días`,
    url: "/panel?tab=fiado",
  };
}
