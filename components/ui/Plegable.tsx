// Bloque que se abre y se cierra con un toque. Lo que no se toca seguido queda cerrado.
export default function Plegable({ titulo, ayuda, abierto = false, children }: { titulo: string; ayuda?: string; abierto?: boolean; children: React.ReactNode }) {
  return (
    <details className="plegable" open={abierto}>
      <summary>{titulo}</summary>
      <div className="plegable-cuerpo">
        {ayuda && <p className="mut" style={{ marginTop: 0 }}>{ayuda}</p>}
        {children}
      </div>
    </details>
  );
}
