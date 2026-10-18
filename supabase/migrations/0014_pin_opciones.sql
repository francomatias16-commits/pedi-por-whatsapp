-- Etapa 8 · PIN de supervisor: las opciones "pedir PIN al anular / al devolver" ya no se cambian con un UPDATE directo.
-- Sin esto, quien tenga la sesión abierta podía apagar la exigencia desde el cliente y saltearse el PIN.
--  * Aflojar la exigencia (pasar una opción de true a false) cuando el kiosco tiene PIN exige un token vigente.
--  * Endurecerla (false a true) o cambiarla mientras no hay PIN no pide nada.
-- Aplicar DESPUÉS de 0013.

revoke update (pin_anular, pin_devolucion) on public.pos_config from authenticated;
revoke insert (pin_anular, pin_devolucion) on public.pos_config from authenticated;

create or replace function public.pos_pin_opciones(p_kiosco uuid, p_anular boolean, p_devolucion boolean, p_token uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c public.pos_config%rowtype;
begin
  if not public.es_dueno(p_kiosco) then raise exception 'no_autorizado'; end if;
  if p_anular is null or p_devolucion is null then raise exception 'opcion_invalida'; end if;
  select * into v_c from public.pos_config where kiosco_id = p_kiosco for update;
  if found and v_c.pin_hash is not null
     and ((v_c.pin_anular and not p_anular) or (v_c.pin_devolucion and not p_devolucion))
     and not public.pos_consumir_token(p_kiosco, p_token) then
    raise exception 'pin_requerido';
  end if;
  insert into public.pos_config (kiosco_id, pin_anular, pin_devolucion) values (p_kiosco, p_anular, p_devolucion)
  on conflict (kiosco_id) do update set pin_anular = excluded.pin_anular, pin_devolucion = excluded.pin_devolucion, updated_at = clock_timestamp();
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.pos_pin_opciones(uuid, boolean, boolean, uuid) from public, anon;
grant execute on function public.pos_pin_opciones(uuid, boolean, boolean, uuid) to authenticated;
