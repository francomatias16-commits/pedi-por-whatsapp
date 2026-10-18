import { createClient } from "@supabase/supabase-js";
import type { Horarios } from "./horario";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export type Kiosco = { id: string; nombre: string; slug: string; whatsapp: string; direccion: string | null; acepta_envio: boolean; sellos_por_premio: number; premio: string; abierto: boolean; horario: string | null; pedido_minimo: number; costo_envio: number; medios_pago: string[]; horario_auto: boolean; horarios: Horarios };
export type Producto = { id: string; kiosco_id: string; barcode: string | null; nombre: string; categoria: string; precio: number; disponible: boolean; imagen_url?: string | null; stock_controlado?: boolean; stock?: number; vendido_por_peso?: boolean; plu?: string | null; permite_sin_stock?: boolean; costo?: number | null; stock_minimo?: number; stock_objetivo?: number | null; lead_time_dias?: number; proveedor_id?: string | null };
export type Pedido = { id: string; numero: number; cliente_nombre: string; cliente_telefono: string; modalidad: "retiro" | "envio"; direccion: string | null; notas: string | null; total: number; estado: "pendiente" | "confirmado" | "entregado" | "cancelado"; created_at: string; medio_pago: string; costo_envio: number };
