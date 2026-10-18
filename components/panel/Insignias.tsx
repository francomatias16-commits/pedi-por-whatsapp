// Número chico junto a un ítem del menú (pedidos por confirmar, cosas por comprar). No se muestra con 0.
export default function Cuenta({ n, que }: { n: number; que: string }) {
  if (n <= 0) return null;
  return <span className="menu-num" aria-label={`${n} ${que}`}>{n > 99 ? "99+" : n}</span>;
}
