-- 0064: reembolso de cobros QR a Mercado Pago desde la devolución de la caja.
-- Aditiva: sin DROP ni DELETE. Aplicar en el SQL Editor ANTES de subir el código.
--
-- Flujo: devolver_venta_mostrador registra la devolución en la caja; después el servidor
-- llama a /v1/orders/{id}/refund y confirma acá. Si Mercado Pago rechaza o se corta,
-- el reembolso queda con error y se puede reintentar sin duplicarlo (la clave de
-- idempotencia es fija por cobro + monto acumulado).

alter table public.cobros_qr_pos
  add column if not exists reembolso_monto numeric(12,2) not null default 0 check (reembolso_monto >= 0),
  add column if not exists reembolso_pendiente numeric(12,2) check (reembolso_pendiente > 0),
  add column if not exists reembolso_ref text,
  add column if not exists reembolso_error text;

-- Reserva el reembolso antes de llamar a Mercado Pago. Un solo reembolso en curso por cobro.
create or replace function public.qr_reservar_reembolso(p_cobro uuid, p_monto numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.cobros_qr_pos%rowtype;
begin
  select * into v from public.cobros_qr_pos where id = p_cobro for update;
  if not found then raise exception 'cobro_no_encontrado'; end if;
  if v.estado not in ('aprobado', 'reembolsado') then raise exception 'cobro_no_reembolsable'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'monto_invalido'; end if;
  if v.reembolso_pendiente is not null then raise exception 'reembolso_en_curso'; end if;
  if v.reembolso_monto + p_monto > v.monto then raise exception 'reembolso_excede_cobro'; end if;
  update public.cobros_qr_pos
     set reembolso_pendiente = p_monto, reembolso_error = null, updated_at = now()
   where id = p_cobro;
  return jsonb_build_object('reembolsado_antes', v.reembolso_monto, 'monto', p_monto, 'cobro_monto', v.monto);
end $$;

-- Confirma el resultado de Mercado Pago. Si el reembolso acumulado cubre el cobro, el cobro queda reembolsado.
create or replace function public.qr_confirmar_reembolso(p_cobro uuid, p_ok boolean, p_ref text, p_error text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.cobros_qr_pos%rowtype;
begin
  select * into v from public.cobros_qr_pos where id = p_cobro for update;
  if not found then raise exception 'cobro_no_encontrado'; end if;
  if v.reembolso_pendiente is null then return jsonb_build_object('resultado', 'sin_reembolso_en_curso'); end if;
  if p_ok then
    update public.cobros_qr_pos
       set reembolso_monto = reembolso_monto + reembolso_pendiente,
           reembolso_pendiente = null,
           reembolso_ref = coalesce(p_ref, reembolso_ref),
           reembolso_error = null,
           estado = case when reembolso_monto + reembolso_pendiente >= monto then 'reembolsado' else estado end,
           updated_at = now()
     where id = p_cobro;
    return jsonb_build_object('resultado', 'reembolsado');
  end if;
  update public.cobros_qr_pos
     set reembolso_pendiente = null, reembolso_error = left(coalesce(p_error, 'error'), 200), updated_at = now()
   where id = p_cobro;
  return jsonb_build_object('resultado', 'error');
end $$;

revoke all on function public.qr_reservar_reembolso(uuid, numeric) from public, anon, authenticated;
revoke all on function public.qr_confirmar_reembolso(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.qr_reservar_reembolso(uuid, numeric) to service_role;
grant execute on function public.qr_confirmar_reembolso(uuid, boolean, text, text) to service_role;
