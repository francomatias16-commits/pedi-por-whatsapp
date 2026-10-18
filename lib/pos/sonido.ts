// Pitidos del POS con Web Audio (sin archivos). Silencioso si el navegador no lo permite.
let ctx: AudioContext | null = null;
export function pitido(tipo: "ok" | "error" | "venta") {
  try {
    const AC = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    ctx = ctx ?? new AC();
    const notas = tipo === "ok" ? [[880, 0.07]] : tipo === "venta" ? [[660, 0.08], [990, 0.12]] : [[220, 0.25]];
    let t = ctx.currentTime;
    for (const [f, d] of notas) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; o.type = tipo === "error" ? "square" : "sine"; g.gain.value = 0.08;
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + d); t += d;
    }
  } catch { /* sin audio */ }
}
