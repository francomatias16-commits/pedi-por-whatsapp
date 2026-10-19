-- 0056: guardarraíles para las promociones de la caja (pos_promos).
--  1) Un producto no puede tener dos promociones activas que se pisen en fechas, ni una promoción de la caja
--     junto a una liquidación activa del mismo producto (regalo o "llevá dos").
--  2) Si la promoción deja el producto por debajo del margen mínimo del local, se rechaza con 'promo_reduce_margen'
--     (el detalle trae "margen|mínimo") salvo que el dueño la confirme con margen_confirmado = true; queda en el historial.
-- Solo controla altas y cambios: las promociones que ya existían siguen funcionando igual (la caja sigue aplicando la más conveniente).
-- Las funciones que arman sus propias promociones (liquidación) hacen sus chequeos y silencian este trigger con app.promo_silencio.

alter table public.pos_promos add column if not exists margen_confirmado boolean not null default false;

create or replace function public.pos_promos_guardarrailes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  k public.kioscos%rowtype;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_final numeric; v_margen numeric; v_peor numeric; r record;
begin
  if current_setting('app.promo_silencio', true) = 'on' then return new; end if;
  if not new.activa then return new; end if;
  if new.hasta is not null and new.hasta < v_hoy then return new; end if; -- ya vencida: no corre
  if tg_op = 'UPDATE' and old.activa
     and new.producto_id is not distinct from old.producto_id and new.categoria is not distinct from old.categoria
     and new.tipo = old.tipo and new.pct is not distinct from old.pct and new.lleva is not distinct from old.lleva
     and new.paga is not distinct from old.paga and new.desde is not distinct from old.desde and new.hasta is not distinct from old.hasta then
    return new; -- solo cambió el nombre u otro dato que no mueve el descuento
  end if;

  -- 1) Una sola promoción por producto
  if new.producto_id is not null and (
       exists (select 1 from public.pos_promos o
                where o.kiosco_id = new.kiosco_id and o.producto_id = new.producto_id and o.activa and o.id <> new.id
                  and (o.hasta is null or o.hasta >= v_hoy)
                  and coalesce(o.desde, date '-infinity') <= coalesce(new.hasta, date 'infinity')
                  and coalesce(new.desde, date '-infinity') <= coalesce(o.hasta, date 'infinity'))
    or exists (select 1 from public.promo_liquidacion l
                where l.kiosco_id = new.kiosco_id and l.producto_id = new.producto_id and l.activa and l.pos_promo_id is distinct from new.id)) then
    raise exception 'promo_producto_duplicada';
  end if;

  -- 2) Margen mínimo: se mira el peor caso entre los productos que alcanza la promoción (los que tienen costo cargado).
  select * into k from public.kioscos where id = new.kiosco_id;
  for r in select precio, costo from public.productos
            where kiosco_id = new.kiosco_id and costo is not null and precio > 0
              and ((new.producto_id is not null and id = new.producto_id) or (new.categoria is not null and categoria = new.categoria)) loop
    v_final := case when new.tipo = 'pct' then r.precio * (1 - new.pct / 100) else r.precio * new.paga / new.lleva end;
    v_margen := case when v_final > 0 then round((v_final - r.costo) / v_final * 100, 1) else -100 end;
    v_peor := least(coalesce(v_peor, v_margen), v_margen);
  end loop;
  if v_peor is not null and v_peor < k.club_margen_minimo then
    if not new.margen_confirmado then
      raise exception 'promo_reduce_margen' using detail = v_peor::text || '|' || k.club_margen_minimo::text;
    end if;
    perform public.promo_historial_registrar(new.kiosco_id, 'margen_confirmado', 'pos_promos', null, new.nombre,
      jsonb_build_object('margen', v_peor, 'minimo', k.club_margen_minimo));
  end if;
  return new;
end $$;
revoke all on function public.pos_promos_guardarrailes() from public, anon, authenticated;

drop trigger if exists trg_pos_promos_guardarrailes on public.pos_promos; -- drop-ok: se recrea justo abajo
create trigger trg_pos_promos_guardarrailes before insert or update on public.pos_promos
  for each row execute function public.pos_promos_guardarrailes();
