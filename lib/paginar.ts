// Trae TODAS las filas de una consulta de Supabase. PostgREST corta cada respuesta en 1000 filas (max_rows) sin avisar:
// un catálogo de más de 1000 productos se vería incompleto. Acá se pide de a páginas con .range() hasta agotar.
// La consulta tiene que tener un orden estable y terminar en .order("id") (desempate), si no las páginas pueden repetir o saltear filas.
// Devuelve la misma forma que supabase-js ({ data, error }) para reemplazar la consulta directa sin tocar el resto.
type Respuesta<T> = { data: T[] | null; error: { message: string } | null };

export async function traerTodo<T>(
  pagina: (desde: number, hasta: number) => PromiseLike<Respuesta<T>>,
  tam = 1000,
  maxPaginas = 100, // tope de seguridad: 100.000 filas
): Promise<{ data: T[]; error: { message: string } | null }> {
  const todo: T[] = [];
  for (let i = 0; i < maxPaginas; i++) {
    const { data, error } = await pagina(i * tam, i * tam + tam - 1);
    if (error) return { data: todo, error };
    const filas = data ?? [];
    todo.push(...filas);
    if (filas.length < tam) break;
  }
  return { data: todo, error: null };
}
