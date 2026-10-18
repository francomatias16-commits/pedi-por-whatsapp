import type { Destino } from "@/lib/navegacion";

// Íconos de trazo (24×24) de cada destino del menú.
export const ICONO_DESTINO: Record<Destino | "mas", string> = {
  inicio: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  vender: "M3 7h18v12H3zM3 7l3-4h12l3 4M8 13h.01M12 13h4",
  pedidos: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 3h6v4H9zM9 12l2 2 4-4",
  productos: "M21 16V8l-9-5-9 5v8l9 5zM3.3 7.5 12 12.5l8.7-5M12 22V12.5",
  clientes: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  compras: "M3 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 2-1.6L22 7H6M10 21h.01M18 21h.01",
  negocio: "M3 10l1.5-6h15L21 10M4 10v10h16V10M9 20v-6h6v6",
  mas: "M5 12h.01M12 12h.01M19 12h.01",
};

export const Icono = ({ d }: { d: string }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
