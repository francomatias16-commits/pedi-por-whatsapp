-- 0035 · Etapa 3D: limpieza de fotos viejas del bucket.
-- Aditiva. Al aplicar una foto nueva, la anterior queda guardada en el bucket para poder deshacer. Esta migración deja que un cron
-- semanal (/api/cron/fotos-limpieza, solo servidor) borre esos archivos cuando pasó el plazo de retención (30 días por defecto):
--  - fotos_historial.limpiada_at: marca las filas ya procesadas (así no se revisan dos veces).
--  - fotos_limpieza_pendientes: filas vencidas y la URL a borrar. Nunca devuelve una URL que un producto use hoy ni una que otra fila reciente aún pueda restaurar.
--  - fotos_limpieza_marcar: marca como procesadas las filas que el servidor ya limpió.
--  - foto_deshacer: pasado el plazo (fila limpiada) responde foto_vencida en vez de volver a un archivo que ya no existe.
-- Aplicar DESPUÉS de 0001..0034.

alter table public.fotos_historial add column if not exists limpiada_at timestamptz;
create index if not exists fotos_historial_sin_limpiar on public.fotos_historial (created_at) where limpiada_at is null;

-- Filas vencidas aún sin procesar. Una fila sin deshacer libera su url_anterior (la foto que se reemplazó);
-- una fila deshecha libera su url_nueva (la UI ya la borra al deshacer; acá se repite por si esa baja falló).
-- url viene en null cuando no hay nada para borrar (sin foto anterior, o la foto sigue en uso): la fila igual se marca como procesada.
create or replace function public.fotos_limpieza_pendientes(p_dias int default 30, p_limite int default 200)
returns table (id uuid, kiosco_id uuid, url text)
language plpgsql security definer set search_path = public as $$
declare v_corte timestamptz := now() - make_interval(days => greatest(coalesce(p_dias, 30), 1));
begin
  return query
  select c.id, c.kiosco_id,
         case when c.u is not null
               and not exists (select 1 from public.productos p where p.imagen_url = c.u)
               and not exists (select 1 from public.fotos_historial o
                                where o.id <> c.id and o.limpiada_at is null and o.deshecho_at is null and o.created_at >= v_corte
                                  and (o.url_anterior = c.u or o.url_nueva = c.u))
              then c.u end
    from (select h.id, h.kiosco_id, h.created_at,
                 case when h.deshecho_at is null then h.url_anterior else h.url_nueva end as u
            from public.fotos_historial h
           where h.limpiada_at is null and coalesce(h.deshecho_at, h.created_at) < v_corte) c
   order by c.created_at
   limit greatest(least(coalesce(p_limite, 200), 1000), 1);
end $$;

create or replace function public.fotos_limpieza_marcar(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update public.fotos_historial set limpiada_at = now() where id = any(coalesce(p_ids, '{}'::uuid[])) and limpiada_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Igual que en 0034, más el control de plazo vencido.
create or replace function public.foto_deshacer(p_kiosco uuid, p_historial uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_h public.fotos_historial%rowtype; v_actual text;
begin
  if auth.uid() is null or not public.es_miembro(p_kiosco, array['encargado', 'dueno']) then raise exception 'no_autorizado'; end if;
  select * into v_h from public.fotos_historial where id = p_historial and kiosco_id = p_kiosco and deshecho_at is null for update;
  if not found then raise exception 'foto_no_encontrada'; end if;
  if v_h.limpiada_at is not null then raise exception 'foto_vencida'; end if;
  select imagen_url into v_actual from public.productos where id = v_h.producto_id and kiosco_id = p_kiosco for update;
  if not found or v_actual is distinct from v_h.url_nueva then raise exception 'foto_cambio_posterior'; end if;
  update public.productos set imagen_url = v_h.url_anterior where id = v_h.producto_id;
  update public.fotos_historial set deshecho_at = now() where id = p_historial;
  return jsonb_build_object('anterior', v_h.url_anterior, 'quitada', v_h.url_nueva);
end $$;

-- Solo el servidor (service role) limpia.
revoke all on function public.fotos_limpieza_pendientes(int, int) from public, anon, authenticated;
revoke all on function public.fotos_limpieza_marcar(uuid[]) from public, anon, authenticated;
revoke all on function public.foto_deshacer(uuid, uuid) from public, anon;
grant execute on function public.foto_deshacer(uuid, uuid) to authenticated;
