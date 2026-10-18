// Lector de código de barras USB (modo "teclado"): distingue una ráfaga de teclas rapidísimas de alguien tipeando.
// Puro y sin DOM: se alimenta con (tecla, marca de tiempo) y devuelve qué hacer con esa tecla.
export type ResultadoTecla =
  | { tipo: "tecla" }                       // tecla normal (tipeo humano o primera tecla de una posible ráfaga)
  | { tipo: "rafaga" }                      // forma parte de una ráfaga: conviene tragársela (no atajos, no escribir)
  | { tipo: "escaneo"; codigo: string };    // ráfaga cerrada con Enter: es un código leído

export class DetectorEscaneo {
  private buf = "";
  private ultimo = 0;
  private rapida = false;
  constructor(private maxGapMs = 50, private minLen = 4) {}

  private reset() { this.buf = ""; this.rapida = false; }
  get enCurso() { return this.buf.length > 0; }

  feed(key: string, t: number): ResultadoTecla {
    if (key === "Enter") {
      const ok = this.rapida && this.buf.length >= this.minLen && t - this.ultimo <= this.maxGapMs * 3;
      const codigo = this.buf;
      this.reset();
      return ok ? { tipo: "escaneo", codigo } : { tipo: "tecla" };
    }
    if (key.length !== 1) return { tipo: "tecla" }; // Shift, Tab, flechas… no cortan la ráfaga
    if (this.buf && t - this.ultimo > this.maxGapMs) this.reset(); // pausa larga: otra cosa
    const hayPrevia = this.buf.length > 0;
    this.buf += key;
    this.rapida = hayPrevia ? (this.buf.length === 2 ? true : this.rapida) : false;
    this.ultimo = t;
    return this.rapida ? { tipo: "rafaga" } : { tipo: "tecla" };
  }

  /** Para lectores que no mandan Enter: si pasó una pausa y la ráfaga es válida, devuelve el código. */
  vaciar(t: number, pausaMs = 120): string | null {
    if (!this.buf || t - this.ultimo < pausaMs) return null;
    const ok = this.rapida && this.buf.length >= this.minLen;
    const codigo = this.buf;
    this.reset();
    return ok ? codigo : null;
  }
}
