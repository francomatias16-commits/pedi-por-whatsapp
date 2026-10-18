-- Etapa 3b: de pedido entregado a fiado en un toque.
--  * fiado_movimientos.pedido_id (único): un pedido no puede anotarse dos veces en la libreta.
--  * pasar_a_fiado(pedido): anota el total del pedido (ítems + envío) como fiado del cliente y,
--    si todavía no estaba entregado, lo marca entregado (eso suma el sello por el trigger existente).
-- Aplicar DESPUÉS de 0001..0004.

alter table public.fiado_movimientos
  add column pedido_id uuid unique references public.pedidos(id) on delete set null;

create or replace function public.pasar_a_fiado(p_pedido uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_p public.pedidos%rowtype;
  v_nuevo boolean := false;
  v_saldo numeric(12,2);
begin
  select * into v_p from public.pedidos where id = p_pedido for update;
  if not found or not public.es_dueno(v_p.kiosco_id) then raise exception 'no_autorizado'; end if;
  if v_p.cliente_id is null then raise exception 'sin_cliente'; end if;
  if v_p.estado not in ('confirmado', 'entregado') then raise exception 'estado_invalido'; end if;
  if v_p.total <= 0 then raise exception 'monto_invalido'; end if;

  insert into public.fiado_movimientos (kiosco_id, cliente_id, tipo, monto, nota, pedido_id)
  values (v_p.kiosco_id, v_p.cliente_id, 'fiado', v_p.total, 'Pedido #' || v_p.numero, v_p.id)
  on conflict (pedido_id) do nothing;
  v_nuevo := found;

  if v_p.estado <> 'entregado' then
    update public.pedidos set estado = 'entregado' where id = v_p.id;
  end if;

  select saldo into v_saldo from public.clientes_saldo where id = v_p.cliente_id;
  return jsonb_build_object('ya_estaba', not v_nuevo, 'saldo', v_saldo);
end $$;

revoke all on function public.pasar_a_fiado(uuid) from public, anon;
grant execute on function public.pasar_a_fiado(uuid) to authenticated;
