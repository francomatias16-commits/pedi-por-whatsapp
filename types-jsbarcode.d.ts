declare module "jsbarcode" {
  type Opciones = { format?: string; displayValue?: boolean; margin?: number; height?: number; width?: number };
  export default function JsBarcode(el: SVGElement | string, valor: string, opciones?: Opciones): void;
}
