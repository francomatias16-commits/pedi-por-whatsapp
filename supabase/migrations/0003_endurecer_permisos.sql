-- Supabase concede EXECUTE a anon/authenticated por default privileges; "revoke from public" no alcanza.
-- Solo crear_pedido es pública (el vecino pide sin cuenta). Todo lo demás es del dueño logueado.
revoke execute on function public.ajustar_precios(uuid, numeric, text, int) from anon;
revoke execute on function public.canjear_premio(uuid) from anon;
revoke execute on function public.revertir_ajuste(uuid) from anon;
revoke execute on function public.previsualizar_ajuste(uuid, numeric, text, int) from anon;
revoke execute on function public.resumen_semana(uuid) from anon;
revoke execute on function public.es_dueno(uuid) from anon;

-- Función de trigger: nadie la llama por la API
revoke execute on function public.sello_por_entrega() from public, anon, authenticated;

-- Funciones puras: fijar search_path
alter function public.normalizar_tel_ar(text) set search_path = '';
alter function public.precio_ajustado(numeric, numeric, int) set search_path = '';
