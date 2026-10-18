// Fotos de producto. El bucket "productos" es público para leer; solo el dueño escribe en la carpeta <kiosco_id>/ (migración 0006).
export const BUCKET = "productos";
export const MAX_BYTES = 400 * 1024;   // el bucket admite 512 KB; se apunta más bajo para cargar rápido con datos móviles
const LADO_MAX = 800;

/** Ruta dentro del bucket a partir de la URL pública; null si la imagen no es de nuestro bucket (p. ej. un link externo). */
export function rutaDeStorage(url: string | null | undefined): string | null {
  if (!url) return null;
  const marca = `/object/public/${BUCKET}/`;
  const i = url.indexOf(marca);
  if (i < 0) return null;
  const ruta = decodeURIComponent(url.slice(i + marca.length).split("?")[0]);
  return ruta || null;
}

export const rutaFoto = (kioscoId: string, productoId: string) => `${kioscoId}/${productoId}-${Date.now()}.jpg`;

/** Achica y recomprime en el celular (una foto de cámara pesa 3–8 MB): lado máx. 800 px, JPEG, hasta MAX_BYTES. */
export async function comprimirImagen(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("no_es_imagen");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => {
      const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error("imagen_ilegible")); i.src = url;
    });
    const escala = Math.min(1, LADO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * escala)), h = Math.max(1, Math.round(img.naturalHeight * escala));
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("sin_canvas");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);                 // PNG con transparencia: fondo blanco
    ctx.drawImage(img, 0, 0, w, h);                                    // el navegador aplica la orientación EXIF
    for (const calidad of [0.82, 0.7, 0.58, 0.45]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", calidad));
      if (blob && blob.size <= MAX_BYTES) return blob;
    }
    throw new Error("imagen_muy_grande");
  } finally { URL.revokeObjectURL(url); }
}
