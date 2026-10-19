import Link from "next/link";

export const metadata = { title: "No encontrado" };

export default function NoEncontrado() {
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>No encontramos esa página</h2>
      <p>Puede que el link esté mal escrito o que el local ya no esté disponible.</p>
      <Link className="btn principal" href="/">Ir al inicio</Link>
    </div>
  );
}
