do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pos_categories' and policyname='pos_categories_no_direct_client_select') then
    create policy pos_categories_no_direct_client_select on public.pos_categories for select to anon, authenticated using (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pos_categories' and policyname='pos_categories_no_direct_client_insert') then
    create policy pos_categories_no_direct_client_insert on public.pos_categories for insert to anon, authenticated with check (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pos_categories' and policyname='pos_categories_no_direct_client_update') then
    create policy pos_categories_no_direct_client_update on public.pos_categories for update to anon, authenticated using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pos_categories' and policyname='pos_categories_no_direct_client_delete') then
    create policy pos_categories_no_direct_client_delete on public.pos_categories for delete to anon, authenticated using (false);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pos_products' and policyname='pos_products_no_direct_client_select') then
    create policy pos_products_no_direct_client_select on public.pos_products for select to anon, authenticated using (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pos_products' and policyname='pos_products_no_direct_client_insert') then
    create policy pos_products_no_direct_client_insert on public.pos_products for insert to anon, authenticated with check (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pos_products' and policyname='pos_products_no_direct_client_update') then
    create policy pos_products_no_direct_client_update on public.pos_products for update to anon, authenticated using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pos_products' and policyname='pos_products_no_direct_client_delete') then
    create policy pos_products_no_direct_client_delete on public.pos_products for delete to anon, authenticated using (false);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pos_product_batches' and policyname='pos_product_batches_no_direct_client_select') then
    create policy pos_product_batches_no_direct_client_select on public.pos_product_batches for select to anon, authenticated using (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pos_product_batches' and policyname='pos_product_batches_no_direct_client_insert') then
    create policy pos_product_batches_no_direct_client_insert on public.pos_product_batches for insert to anon, authenticated with check (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pos_product_batches' and policyname='pos_product_batches_no_direct_client_update') then
    create policy pos_product_batches_no_direct_client_update on public.pos_product_batches for update to anon, authenticated using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pos_product_batches' and policyname='pos_product_batches_no_direct_client_delete') then
    create policy pos_product_batches_no_direct_client_delete on public.pos_product_batches for delete to anon, authenticated using (false);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pos_customers' and policyname='pos_customers_no_direct_client_select') then
    create policy pos_customers_no_direct_client_select on public.pos_customers for select to anon, authenticated using (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pos_customers' and policyname='pos_customers_no_direct_client_insert') then
    create policy pos_customers_no_direct_client_insert on public.pos_customers for insert to anon, authenticated with check (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pos_customers' and policyname='pos_customers_no_direct_client_update') then
    create policy pos_customers_no_direct_client_update on public.pos_customers for update to anon, authenticated using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pos_customers' and policyname='pos_customers_no_direct_client_delete') then
    create policy pos_customers_no_direct_client_delete on public.pos_customers for delete to anon, authenticated using (false);
  end if;
end $$;

revoke all on table public.pos_categories from anon, authenticated;
revoke all on table public.pos_products from anon, authenticated;
revoke all on table public.pos_product_batches from anon, authenticated;
revoke all on table public.pos_customers from anon, authenticated;
revoke all on table public.pos_sync_events from anon, authenticated;
revoke all on table public.pos_idempotency_keys from anon, authenticated;
revoke all on table public.pos_sync_conflicts from anon, authenticated;

comment on table public.pos_categories is 'FASE 2 POS Sync: catalogo cloud de categorias por licencia. RLS activo sin acceso directo cliente; lectura/escritura via RPC SECURITY DEFINER que valida licencia, dispositivo, token, staff/permisos y feature cloud_products_sync.';
comment on table public.pos_products is 'FASE 2 POS Sync: catalogo cloud de productos por licencia. RLS activo sin acceso directo cliente; lectura/escritura via RPC SECURITY DEFINER que valida licencia, dispositivo, token, staff/permisos y feature cloud_products_sync.';
comment on table public.pos_product_batches is 'FASE 2 POS Sync: lotes cloud de productos por licencia. RLS activo sin acceso directo cliente; lectura/escritura via RPC SECURITY DEFINER que valida licencia, dispositivo, token, staff/permisos y feature cloud_products_sync.';
comment on table public.pos_customers is 'FASE 1 POS Sync: directorio cloud de clientes por licencia. RLS activo sin acceso directo cliente; lectura/escritura via RPC SECURITY DEFINER que valida licencia, dispositivo, token, staff/permisos y feature cloud_pos_sync.';
comment on table public.pos_sync_events is 'Motor POS Sync: bitacora de eventos por licencia. Sin acceso directo cliente; solo RPCs validadas registran/leen eventos.';
comment on table public.pos_idempotency_keys is 'Motor POS Sync: control de idempotencia por licencia. Sin acceso directo cliente; solo RPCs validadas crean/completan claves.';
comment on table public.pos_sync_conflicts is 'Motor POS Sync: conflictos por licencia. Sin acceso directo cliente; RPCs validadas registran conflictos y el cliente mantiene cache local.';

comment on function public.pos_pull_product_catalog_snapshot(text, text, text, text, text, integer, integer, boolean) is 'RPC catalogo productos: SECURITY DEFINER intencional. Valida licencia/dispositivo/security token/staff session y cloud_products_sync antes de leer por licencia.';
comment on function public.pos_pull_product_catalog_changes(text, text, text, text, bigint, integer) is 'RPC catalogo productos: SECURITY DEFINER intencional. Valida contexto POS y devuelve cambios solo de la licencia solicitante.';
comment on function public.pos_upsert_category(text, text, text, text, jsonb, integer, text) is 'RPC catalogo productos: escritura de categoria via SECURITY DEFINER. Valida contexto, permisos products, feature cloud_products_sync, idempotencia y version.';
comment on function public.pos_delete_category(text, text, text, text, text, integer, text) is 'RPC catalogo productos: borrado logico de categoria via SECURITY DEFINER. Valida contexto, permisos products, idempotencia y version.';
comment on function public.pos_upsert_product(text, text, text, text, jsonb, jsonb, integer, text) is 'RPC catalogo productos: escritura de producto via SECURITY DEFINER. Valida contexto, permisos products, feature cloud_products_sync, idempotencia, version y unicidad SKU/barcode por licencia.';
comment on function public.pos_delete_product(text, text, text, text, text, integer, text) is 'RPC catalogo productos: borrado logico de producto via SECURITY DEFINER. Valida contexto, permisos products, idempotencia y version.';
comment on function public.pos_toggle_product_status(text, text, text, text, text, boolean, integer, text) is 'RPC catalogo productos: cambio de estado via SECURITY DEFINER. Valida contexto, permisos products, idempotencia y version.';
comment on function public.pos_upsert_product_batch(text, text, text, text, jsonb, integer, text) is 'RPC catalogo productos: escritura de lote via SECURITY DEFINER. Valida contexto, permisos products, producto padre de la misma licencia, idempotencia y version.';
comment on function public.pos_delete_product_batch(text, text, text, text, text, integer, text) is 'RPC catalogo productos: archivado de lote via SECURITY DEFINER. Valida contexto, permisos products, idempotencia y version.';
comment on function public.pos_migrate_local_product_catalog(text, text, text, text, jsonb, jsonb, jsonb, text) is 'RPC catalogo productos: migracion inicial local a cloud. SECURITY DEFINER intencional con validacion de contexto POS, permisos products, feature cloud_products_sync e idempotencia por batch.';

create index if not exists idx_pos_categories_created_by_device_id on public.pos_categories (created_by_device_id);
create index if not exists idx_pos_categories_updated_by_device_id on public.pos_categories (updated_by_device_id);
create index if not exists idx_pos_categories_created_by_staff_user_id on public.pos_categories (created_by_staff_user_id);
create index if not exists idx_pos_categories_updated_by_staff_user_id on public.pos_categories (updated_by_staff_user_id);

create index if not exists idx_pos_customers_created_by_device_id on public.pos_customers (created_by_device_id);
create index if not exists idx_pos_customers_updated_by_device_id on public.pos_customers (updated_by_device_id);
create index if not exists idx_pos_customers_created_by_staff_user_id on public.pos_customers (created_by_staff_user_id);
create index if not exists idx_pos_customers_updated_by_staff_user_id on public.pos_customers (updated_by_staff_user_id);

create index if not exists idx_pos_products_category_id on public.pos_products (category_id);
create index if not exists idx_pos_products_created_by_device_id on public.pos_products (created_by_device_id);
create index if not exists idx_pos_products_updated_by_device_id on public.pos_products (updated_by_device_id);
create index if not exists idx_pos_products_created_by_staff_user_id on public.pos_products (created_by_staff_user_id);
create index if not exists idx_pos_products_updated_by_staff_user_id on public.pos_products (updated_by_staff_user_id);

create index if not exists idx_pos_product_batches_product_id on public.pos_product_batches (product_id);
create index if not exists idx_pos_product_batches_created_by_device_id on public.pos_product_batches (created_by_device_id);
create index if not exists idx_pos_product_batches_updated_by_device_id on public.pos_product_batches (updated_by_device_id);
create index if not exists idx_pos_product_batches_created_by_staff_user_id on public.pos_product_batches (created_by_staff_user_id);
create index if not exists idx_pos_product_batches_updated_by_staff_user_id on public.pos_product_batches (updated_by_staff_user_id);

create index if not exists idx_pos_sync_events_actor_device_id on public.pos_sync_events (actor_device_id);
create index if not exists idx_pos_sync_events_actor_staff_user_id on public.pos_sync_events (actor_staff_user_id);
create index if not exists idx_pos_sync_conflicts_actor_device_id on public.pos_sync_conflicts (actor_device_id);
create index if not exists idx_pos_sync_conflicts_actor_staff_user_id on public.pos_sync_conflicts (actor_staff_user_id);;
