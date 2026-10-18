-- Etapa 3 · cierre (libreta): borrar un cliente de la libreta.
-- Borra el cliente y, por cascada, su fiado, sellos y canjes. Los pedidos se conservan
-- (cliente_id queda en null). Solo puede ejecutarlo el dueño del kiosco del cliente.
create or replace function public.borrar_cliente(p_cliente uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_kiosco uuid;
begin
  select kiosco_id into v_kiosco from public.clientes where id = p_cliente;
  if not found or not public.es_dueno(v_kiosco) then raise exception 'no_autorizado'; end if;
  delete from public.clientes where id = p_cliente;
  return true;
end $$;

revoke all on function public.borrar_cliente(uuid) from public, anon;
grant execute on function public.borrar_cliente(uuid) to authenticated;
