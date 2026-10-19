-- 0045 · Promociones, Fase A: catálogo de opciones, configuración de margen y tope, y rentabilidad calculada.
-- Aplicar DESPUÉS de 0044. Sin DROP. Todo lo que el kiosquero ve como "Recomendado" sale de estas funciones.
--  * promo_catalogo: las opciones ya armadas (captar, retener, premios por etapas, liquidar). Cada una dice en qué fase está.
--    Solo las de fase 'A' se pueden activar con esta migración; el resto aparece en el catálogo como "próximamente".
--  * kioscos.club_margen_minimo y club_tope_promos_pct: piso de margen y tope de costo de promociones (valores por defecto editables).
--  * club_evaluar(p_kiosco): para cada premio activo calcula costo para el local, compras y gasto para llegar a él,
--    semáforo (conviene / ajustado / pierde_plata / reduce_margen / sin_datos) y una frase en castellano.

alter table public.kioscos
  add column if not exists club_margen_minimo numeric(5,2) not null default 20 check (club_margen_minimo between 0 and 90),
  add column if not exists club_tope_promos_pct numeric(5,2) not null default 5 check (club_tope_promos_pct between 0 and 50);

create table public.promo_catalogo (
  clave text primary key,
  familia text not null check (familia in ('captar', 'retener', 'premio_etapa', 'liquidar')),
  nombre text not null,
  descripcion text not null,
  fase text not null check (fase in ('A', 'B', 'C')),
  automatica boolean not null default false,
  tipo_campana text,
  orden int not null
);
alter table public.promo_catalogo enable row level security;
create policy promo_catalogo_lectura on public.promo_catalogo for select using (true);
grant select on public.promo_catalogo to anon, authenticated;
revoke insert, update, delete on public.promo_catalogo from anon, authenticated;

insert into public.promo_catalogo (clave, familia, nombre, descripcion, fase, automatica, tipo_campana, orden) values
  ('bienvenida', 'captar', 'Sellos de bienvenida', 'Sellos extra al registrarse en el club.', 'A', true, 'bienvenida', 1),
  ('doble_primera_compra', 'captar', 'Doble sello en la primera compra', 'La primera compra del cliente suma el doble.', 'A', true, 'bienvenida', 2),
  ('sellos_dobles_dias_flojos', 'retener', 'Sellos dobles en días flojos', 'Doble sello en los días que menos se vende, por ejemplo martes y miércoles.', 'A', false, 'multiplicador', 3),
  ('reactivacion', 'retener', 'Volver a buscarlo', 'Sello extra para quien no compra hace X días.', 'A', true, 'reactivacion', 4),
  ('premio_por_etapas', 'premio_etapa', 'Premios por etapas', 'Niveles de 5, 10 y 20 sellos, cada uno con su premio.', 'C', false, null, 5),
  ('racha', 'retener', 'Racha de compras', 'Premio por X semanas seguidas de compra.', 'B', false, null, 6),
  ('regalo_cumpleanos', 'retener', 'Regalo de cumpleaños', 'Un regalo en el mes del cumpleaños del cliente.', 'B', true, null, 7),
  ('referido', 'captar', 'Traé un amigo', 'Si un cliente trae a alguien, los dos suman sellos.', 'B', false, null, 8),
  ('liquidar_sin_rotacion', 'liquidar', 'Productos sin rotación como regalo', 'Un producto que no se vende hace tiempo se regala o se suma a un combo.', 'B', false, null, 9),
  ('descuento_sin_movimiento', 'liquidar', 'Descuento en productos parados', 'Descuento en productos que llevan días sin venderse.', 'B', false, null, 10),
  ('llevá_dos_suma_mas', 'liquidar', 'Llevá dos y sumá sellos extra', 'Si compra dos unidades del mismo producto, suma sellos de más.', 'B', false, null, 11);

-- Umbrales del semáforo (porcentaje del gasto que le cuesta al cliente llegar al premio que le cuesta al local).
-- Conviene hasta 10%, ajustado hasta 25%, pierde plata por encima.
create or replace function public.club_evaluar(p_kiosco uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  k public.kioscos%rowtype; v_ticket numeric; v_sellos_compra numeric; v_out jsonb := '[]'::jsonb;
  p public.fidelidad_premios%rowtype; v_costo numeric; v_precio numeric; v_margen numeric; v_compras int; v_gasto numeric; v_pct numeric; v_sem text; v_frase text; v_motivo text;
begin
  if not public.es_miembro(p_kiosco, array['encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  select * into k from public.kioscos where id = p_kiosco;

  -- Ticket promedio de los últimos 90 días: ventas de mostrador y pedidos entregados.
  select avg(t.total) into v_ticket from (
    select total from public.ventas_mostrador where kiosco_id = p_kiosco and not anulada and created_at > now() - interval '90 days'
    union all
    select total from public.pedidos where kiosco_id = p_kiosco and entregado_at is not null and entregado_at > now() - interval '90 days'
  ) t;

  -- Sellos que deja una compra promedio, según las campañas activas de compra (visita y monto).
  select coalesce(sum(case c.tipo
           when 'visita' then c.sellos
           when 'monto' then (coalesce(v_ticket, 0) / nullif(c.por_monto, 0)) * c.sellos
           else 0 end), 0) into v_sellos_compra
    from public.fidelidad_campanas c where c.kiosco_id = p_kiosco and c.activa and c.tipo in ('visita', 'monto');

  for p in select * from public.fidelidad_premios f where f.kiosco_id = p_kiosco and f.activo order by f.costo_sellos, f.created_at loop
    v_costo := null; v_precio := null; v_margen := null; v_motivo := null;
    if p.tipo = 'producto' then
      select pr.costo, pr.precio into v_costo, v_precio from public.productos pr where pr.id = p.producto_id;
    elsif p.tipo = 'pct' then
      v_costo := coalesce(v_ticket, 0) * p.valor / 100;
    elsif p.tipo = 'monto' then
      v_costo := p.valor;
    end if;

    -- Margen del producto que se regala: no puede caer por debajo del piso del kiosquero.
    if p.tipo = 'producto' and v_precio is not null and v_precio > 0 and v_costo is not null then
      v_margen := round((v_precio - v_costo) / v_precio * 100, 1);
    end if;

    -- El margen no depende de las ventas: si el producto ya deja poco margen, se marca aunque no haya historial.
    if v_margen is not null and v_margen < k.club_margen_minimo then
      v_sem := 'reduce_margen';
      v_motivo := format('Deja un margen de %s%%, por debajo del mínimo de %s%%.', v_margen, k.club_margen_minimo);
      v_compras := null; v_gasto := null; v_pct := null;
    elsif v_sellos_compra <= 0 or v_ticket is null then
      v_sem := 'sin_datos';
      v_motivo := 'Todavía no hay compras suficientes para calcular.';
      v_compras := null; v_gasto := null; v_pct := null;
    else
      v_compras := ceil(p.costo_sellos / v_sellos_compra)::int;
      v_gasto := v_compras * v_ticket;
      if v_costo is null then
        v_sem := 'sin_datos';
        v_motivo := 'Falta el costo del producto o el valor del descuento.';
        v_pct := null;
      else
        v_pct := round(v_costo / nullif(v_gasto, 0) * 100, 1);
        if v_pct <= 10 then v_sem := 'conviene';
        elsif v_pct <= 25 then v_sem := 'ajustado';
        else v_sem := 'pierde_plata';
        end if;
      end if;
    end if;

    v_frase := case v_sem
      when 'sin_datos' then v_motivo
      when 'reduce_margen' then v_motivo
      else format('Le cuesta al local $%s. Llegar a él lleva unas %s compras de $%s en promedio. %s.',
                  round(v_costo), v_compras, round(v_ticket),
                  case v_sem when 'conviene' then 'Conviene' when 'ajustado' then 'Está ajustado' else 'Pierde plata' end)
    end;

    v_out := v_out || jsonb_build_object(
      'premio_id', p.id, 'nombre', p.nombre, 'tipo', p.tipo, 'costo_sellos', p.costo_sellos,
      'costo_local', round(v_costo, 2), 'margen_pct', v_margen, 'compras_para_llegar', v_compras,
      'gasto_para_llegar', round(v_gasto, 2), 'pct_del_gasto', v_pct, 'semaforo', v_sem, 'frase', v_frase);
  end loop;

  return jsonb_build_object('ticket_promedio', round(v_ticket, 2), 'sellos_por_compra', round(v_sellos_compra, 2),
    'margen_minimo', k.club_margen_minimo, 'tope_promos_pct', k.club_tope_promos_pct, 'premios', v_out);
end $$;

-- Catálogo de opciones: la lista la lee cualquiera (es igual para todos los locales).
-- La factibilidad por local (stock, margen, tope) se calcula con club_evaluar.
revoke all on function public.club_evaluar(uuid) from public, anon;
grant execute on function public.club_evaluar(uuid) to authenticated;
