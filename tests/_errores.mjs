// Helper de pruebas: los módulos de lib/ importan "./errores". Las pruebas cargan cada archivo aislado (como data URL),
// así que se inlinea errores.ts en el lugar del import. Uso: inlinarErrores(textoDelArchivo).
import { readFileSync } from "node:fs";
const fuenteErrores = readFileSync(new URL("../lib/errores.ts", import.meta.url), "utf8").replace(/^export /gm, "");
export const inlinarErrores = (src) => src.replace(/^import \{ mensajeErrorSql \} from "\.\/errores";$/m, fuenteErrores);
