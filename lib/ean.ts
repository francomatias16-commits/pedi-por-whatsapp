// EAN-8, UPC-A (12) o EAN-13, con dígito verificador. Sin dependencias (se usa también en la carga masiva).
export function esCodigoValido(codigo: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13})$/.test(codigo)) return false;
  const d = codigo.split("").map(Number);
  const check = d.pop()!;
  const suma = d.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (suma % 10)) % 10 === check;
}
