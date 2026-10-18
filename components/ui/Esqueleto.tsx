// Reemplaza al texto "Cargando…": muestra la forma de lo que va a aparecer.
export default function Esqueleto({ lineas = 3 }: { lineas?: number }) {
  return (
    <div className="card" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: lineas }, (_, i) => <div key={i} className={`esq${i === 0 ? " esq-t" : i === lineas - 1 ? " esq-b" : ""}`} />)}
    </div>
  );
}
