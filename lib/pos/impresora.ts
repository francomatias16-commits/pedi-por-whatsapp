// Impresora térmica directa por USB (WebUSB) o puerto serie / Bluetooth clásico (Web Serial). Solo Chrome/Edge de escritorio y Android.
// Sin impresora conectada, el POS usa la impresión normal del navegador (window.print).
// El permiso lo da el usuario una vez (botón "Conectar"); después el navegador lo recuerda y se reconecta solo.
type Enlace = { tipo: "usb" | "serial"; nombre: string; enviar: (b: Uint8Array) => Promise<void>; cerrar: () => Promise<void> };
let enlace: Enlace | null = null;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((f) => f());
export const alCambiarImpresora = (f: () => void) => { oyentes.add(f); return () => { oyentes.delete(f); }; };

// Tipos mínimos: TypeScript no trae las definiciones de estas APIs.
type UsbEndpoint = { endpointNumber: number; direction: "in" | "out"; type: string };
type UsbDev = {
  productName?: string; vendorId: number; opened: boolean; configuration: unknown;
  configurations: { interfaces: { interfaceNumber: number; alternates: { endpoints: UsbEndpoint[] }[] }[] }[];
  open(): Promise<void>; close(): Promise<void>; selectConfiguration(n: number): Promise<void>; claimInterface(n: number): Promise<void>;
  transferOut(ep: number, d: BufferSource): Promise<unknown>;
};
type SerialPortL = { open(o: { baudRate: number }): Promise<void>; close(): Promise<void>; writable: WritableStream<Uint8Array> | null; getInfo(): { usbVendorId?: number } };
const nav = () => navigator as unknown as { usb?: { requestDevice(o: unknown): Promise<UsbDev>; getDevices(): Promise<UsbDev[]> }; serial?: { requestPort(o?: unknown): Promise<SerialPortL>; getPorts(): Promise<SerialPortL[]> } };

export const soporte = () => (typeof navigator === "undefined" ? { usb: false, serial: false } : { usb: !!nav().usb, serial: !!nav().serial });
export const impresoraConectada = () => (enlace ? { tipo: enlace.tipo, nombre: enlace.nombre } : null);

async function enlazarUsb(d: UsbDev): Promise<Enlace> {
  if (!d.opened) await d.open();
  if (!d.configuration) await d.selectConfiguration(1);
  let sel: { n: number; ep: number } | null = null;
  for (const i of d.configurations[0]?.interfaces ?? []) {
    const ep = i.alternates[0]?.endpoints.find((e) => e.direction === "out" && e.type === "bulk");
    if (ep) { sel = { n: i.interfaceNumber, ep: ep.endpointNumber }; break; }
  }
  if (!sel) throw new Error("sin_endpoint");
  await d.claimInterface(sel.n);
  const ep = sel.ep;
  return { tipo: "usb", nombre: d.productName || "Impresora USB", enviar: async (b) => { await d.transferOut(ep, b as unknown as BufferSource); }, cerrar: async () => { try { await d.close(); } catch { /* ya cerrada */ } } };
}
async function enlazarSerie(p: SerialPortL, baud: number): Promise<Enlace> {
  try { await p.open({ baudRate: baud }); } catch (e) { if (!(e instanceof Error) || !/already open/i.test(e.message)) throw e; }
  const nombre = p.getInfo().usbVendorId ? "Impresora serie (USB)" : "Impresora serie / Bluetooth";
  return {
    tipo: "serial", nombre,
    enviar: async (b) => { const w = p.writable!.getWriter(); try { await w.write(b); } finally { w.releaseLock(); } },
    cerrar: async () => { try { await p.close(); } catch { /* ya cerrado */ } },
  };
}

async function fijar(e: Enlace) { if (enlace) await enlace.cerrar(); enlace = e; avisar(); return { tipo: e.tipo, nombre: e.nombre }; }

/** Debe llamarse desde un click: el navegador pide elegir el dispositivo. */
export async function conectarUsb() {
  const u = nav().usb; if (!u) throw new Error("no_soportado");
  const d = await u.requestDevice({ filters: [{ classCode: 7 }] }); // clase 7 = impresoras
  return fijar(await enlazarUsb(d));
}
export async function conectarSerie(baud = 9600) {
  const s = nav().serial; if (!s) throw new Error("no_soportado");
  return fijar(await enlazarSerie(await s.requestPort(), baud));
}
/** Al abrir el POS: si el usuario ya autorizó una impresora antes, la reconecta sin preguntar. */
export async function reconectarImpresora(baud = 9600) {
  if (enlace) return impresoraConectada();
  try {
    const u = nav().usb;
    const ds = u ? (await u.getDevices()).filter((d) => d.configurations?.some((c) => c.interfaces.some((i) => i.alternates[0]?.endpoints.some((e) => e.direction === "out")))) : [];
    if (ds.length === 1) return await fijar(await enlazarUsb(ds[0]));
    const s = nav().serial; const ps = s ? await s.getPorts() : [];
    if (ps.length === 1 && !ds.length) return await fijar(await enlazarSerie(ps[0], baud));
  } catch { /* sin permiso previo o dispositivo ocupado: se usa la impresión del navegador */ }
  return null;
}
export async function desconectarImpresora() { if (enlace) { await enlace.cerrar(); enlace = null; avisar(); } }

/** Manda bytes a la impresora. Devuelve false si no hay una conectada o falló (el llamador cae a window.print). */
export async function enviarAImpresora(bytes: Uint8Array): Promise<boolean> {
  if (!enlace) return false;
  try { await enlace.enviar(bytes); return true; }
  catch { await desconectarImpresora(); return false; } // se desenchufó o la tomó otro programa
}

export const mensajeImpresora = (e: unknown) => {
  const m = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  if (/NotFoundError|No device selected|cancel/i.test(m)) return "No elegiste ninguna impresora.";
  if (/no_soportado/.test(m)) return "Este navegador no permite conectar impresoras directo. Usá Chrome o Edge.";
  if (/SecurityError|NetworkError|Access denied|claimInterface|busy|in use/i.test(m)) return "No pudimos tomar la impresora: puede que otro programa o el driver de Windows la esté usando. Probá por puerto serie o cerrá el otro programa.";
  if (/sin_endpoint/.test(m)) return "Ese dispositivo no parece una impresora de tickets.";
  return "No pudimos conectar la impresora.";
};
