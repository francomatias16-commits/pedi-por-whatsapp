-- 0037 · Revisión de rendimiento y seguridad (sin cambios de comportamiento).
-- Aditiva y reversible en lo funcional. Aplicar DESPUÉS de 0001..0036.
--  1. Políticas RLS: auth.uid() pasa a (select auth.uid()). Así Postgres lo evalúa una vez por consulta
--     y no una vez por fila. Mismo significado, menos trabajo a medida que crece la base.
--  2. Índices para las claves foráneas más usadas de pedidos (cliente, zona y franja).
--  3. Se quita la crear_pedido de 8 argumentos (versión anterior a las zonas). Nada la usa: la de 9 y la de 10 siguen.

-- 1. Políticas
alter policy kiosco_miembros_lectura on public.kiosco_miembros
  using ((user_id = (select auth.uid())) or public.es_dueno(kiosco_id));

alter policy kioscos_insert_dueno on public.kioscos
  with check (owner_id = (select auth.uid()));
alter policy kioscos_update_dueno on public.kioscos
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
alter policy kioscos_delete_dueno on public.kioscos
  using (owner_id = (select auth.uid()));

alter policy push_dueno on public.push_suscripciones
  with check (public.es_miembro(kiosco_id, array['cajero', 'encargado', 'dueno']) and usuario = (select auth.uid()));

-- 2. Índices de claves foráneas de pedidos
create index if not exists pedidos_cliente_id_idx on public.pedidos (cliente_id);
create index if not exists pedidos_zona_id_idx on public.pedidos (zona_id);
create index if not exists pedidos_franja_id_idx on public.pedidos (franja_id);

-- 3. Versión vieja de crear_pedido (8 argumentos, anterior a zonas y franjas). Sin dependientes.
-- drop-ok: crear_pedido de 8 argumentos. Sin dependientes (revisado en producción); la app usa la de 10.
drop function if exists public.crear_pedido(text, text, text, public.modalidad_pedido, text, text, jsonb, text);
