import { createClient } from "@supabase/supabase-js";
import type { Horarios } from "./horario";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export type Kiosco = { es_demo?: boolean; id: string; nombre: string; slug: string; whatsapp: string; direccion: string | null; acepta_envio: boolean; sellos_por_premio: number; premio: string; abierto: boolean; horario: string | null; pedido_minimo: number; costo_envio: number; medios_pago: string[]; horario_auto: boolean; horarios: Horarios; baja_solicitada_at?: string | null; cobro_online_activo?: boolean; seguimiento_activo?: boolean; zonas_envio_activo?: boolean; fotos_auto_activo?: boolean; franjas_entrega_activo?: boolean; tienda_activa?: boolean; club_activo?: boolean; club_max_por_dia?: number | null; club_espera_min?: number | null; club_hora_desde?: string | null; club_hora_hasta?: string | null; club_margen_minimo?: number; club_tope_promos_pct?: number; club_aviso_previo_dias?: number };
export type Producto = { id: string; kiosco_id: string; barcode: string | null; nombre: string; categoria: string; precio: number; disponible: boolean; visible_tienda?: boolean; imagen_url?: string | null; stock_controlado?: boolean; stock?: number; vendido_por_peso?: boolean; plu?: string | null; permite_sin_stock?: boolean; costo?: number | null; stock_minimo?: number; stock_objetivo?: number | null; lead_time_dias?: number; proveedor_id?: string | null };
export type Pedido = { id: string; numero: number; cliente_nombre: string; cliente_telefono: string; modalidad: "retiro" | "envio"; direccion: string | null; notas: string | null; total: number; estado: "pendiente" | "confirmado" | "entregado" | "cancelado"; created_at: string; medio_pago: string; costo_envio: number; pago_estado?: "no_aplica" | "pendiente" | "pagado" | "fallido" | "reembolsado"; token_seguimiento?: string; zona_nombre?: string | null; franja_nombre?: string | null; entrega_estado?: "listo" | "en_camino" | null };
