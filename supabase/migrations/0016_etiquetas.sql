-- Etapa 10 · Etiquetas de precio con código de barras.
-- Portado del generador de etiquetas de distrib y simplificado para un kiosco:
--  * Config por kiosco (medidas de la etiqueta, columnas, margen, tipo de código, qué mostrar).
--  * El armado e impresión se hacen en el navegador (window.print); la base solo guarda la configuración.
--  * El precio tachado sale de las promos del POS (pos_promos), no de un motor aparte.
-- Aplicar DESPUÉS de 0001..0015.

create table public.config_etiquetas (
  kiosco_id uuid primary key references public.kioscos(id) on delete cascade,
  ancho_mm numeric(5,1) not null default 50 check (ancho_mm between 20 and 120),
  alto_mm numeric(5,1) not null default 25 check (alto_mm between 15 and 100),
  columnas int not null default 3 check (columnas between 1 and 6),
  margen_mm numeric(4,1) not null default 2 check (margen_mm between 0 and 10),
  simbologia text not null default 'auto' check (simbologia in ('auto', 'ean13', 'code128')),
  mostrar_codigo boolean not null default true,
  mostrar_promos boolean not null default true,
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.config_etiquetas enable row level security;
create policy config_etiquetas_dueno on public.config_etiquetas for all to authenticated
  using (public.es_dueno(kiosco_id)) with check (public.es_dueno(kiosco_id));
revoke all on public.config_etiquetas from anon, authenticated;
grant select, insert, update on public.config_etiquetas to authenticated;
