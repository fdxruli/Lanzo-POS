-- DIRECT_RECIPE_PARTIAL_V1. Solo venta directa de cajero con inventario.
-- No altera reservas de mesas, RPC de crédito, ni clientes legacy.
-- No instalar sin validación y autorización de Production.

create or replace function public.pos_direct_partial_inventory_contract_v1()
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('enabled', true, 'version', 'direct_recipe_v1');
$$;
revoke all on function public.pos_direct_partial_inventory_contract_v1() from public;
grant execute on function public.pos_direct_partial_inventory_contract_v1() to anon, authenticated;

create or replace function private.resolve_direct_partial_inventory_v1(
  p_license_id uuid, p_expanded_items jsonb, p_sale_id text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_context jsonb := nullif(pg_catalog.current_setting('lanzo.direct_partial_recipe_v1', true), '')::jsonb;
  v_approval jsonb;
  v_entry record;
  v_product public.pos_products;
  v_source public.pos_products;
  v_batch public.pos_product_batches;
  v_norm jsonb;
  v_metadata jsonb;
  v_id text;
  v_line_id text;
  v_source_type text;
  v_source_id text;
  v_needed numeric;
  v_pending numeric;
  v_available numeric;
  v_consumed numeric;
  v_missing numeric;
  v_cost numeric;
  v_ledger_products jsonb := '{}'::jsonb;
  v_ledger_batches jsonb := '{}'::jsonb;
  v_summary jsonb := '{}'::jsonb;
  v_component jsonb;
  v_allocations jsonb := '[]'::jsonb;
  v_recipe_ingredient boolean;
  v_excess numeric;
begin
  if v_context is null
    or v_context->>'sale_id' is distinct from p_sale_id
    or v_context->>'license_id' is distinct from p_license_id::text
    or pg_catalog.jsonb_typeof(p_expanded_items) is distinct from 'array'
  then
    raise exception 'DIRECT_PARTIAL_CONTEXT_INVALID' using errcode='P0001';
  end if;
  v_approval := v_context->'approval';
  if pg_catalog.jsonb_typeof(v_approval->'maxMissing') is distinct from 'object'
    or pg_catalog.jsonb_array_length(p_expanded_items) > 200
  then
    raise exception 'DIRECT_PARTIAL_REQUIREMENTS_INVALID' using errcode='P0001';
  end if;

  -- Deterministic locks: all products, then all batches. Held through
  -- the financial commit and inventory movements in the same SQL transaction.
  perform p.id from public.pos_products p
    where p.license_id=p_license_id
      and p.id in (
        select distinct nullif(coalesce(e.value->>'product_id', e.value->>'productId'), '')
        from pg_catalog.jsonb_array_elements(p_expanded_items) e
      )
    order by p.id for update;
  perform b.id from public.pos_product_batches b
    where b.license_id=p_license_id
      and b.product_id in (
        select distinct nullif(coalesce(e.value->>'product_id', e.value->>'productId'), '')
        from pg_catalog.jsonb_array_elements(p_expanded_items) e
      )
    order by b.id for update;

  -- Full-stock direct products take priority over recipe partial quantities.
  for v_entry in
    select e.value as item, e.ordinality as ord
    from pg_catalog.jsonb_array_elements(p_expanded_items) with ordinality e
    order by case when e.value->'metadata'->>'inventorySource'='recipe' then 1 else 0 end,
             e.value->>'product_id', e.ordinality
  loop
    v_norm := private.normalize_sale_inventory_item(v_entry.item, v_entry.ord);
    v_id := nullif(v_norm->>'product_id','');
    v_line_id := nullif(v_norm->>'item_id','');
    v_needed := coalesce(nullif(v_norm->>'quantity','')::numeric,0);
    v_cost := nullif(v_norm->>'unit_cost','')::numeric;
    v_metadata := coalesce(v_entry.item->'metadata','{}'::jsonb);
    v_source_type := coalesce(v_metadata->>'inventorySource','product');
    v_source_id := nullif(v_metadata->>'sourceProductId','');
    if v_id is null or v_line_id is null or v_needed <= 0 or v_needed > 1000000
      or v_source_type not in ('recipe','product','modifier')
      or nullif(v_norm->>'batch_id','') is not null
      or pg_catalog.jsonb_array_length(coalesce(v_norm->'batches_used','[]'::jsonb)) > 0
    then
      raise exception 'DIRECT_PARTIAL_UNSUPPORTED_ITEM' using errcode='P0001';
    end if;

    select * into v_product from public.pos_products p
      where p.license_id=p_license_id and p.id=v_id;
    if v_product.id is null or v_product.deleted_at is not null
       or v_product.is_active is not true or v_product.track_stock is not true
       or v_product.stock is null or v_product.committed_stock is null
       or v_product.stock < 0 or v_product.committed_stock < 0
       or v_product.committed_stock > v_product.stock
    then
      raise exception 'DIRECT_PARTIAL_INGREDIENT_UNKNOWN:%', v_id using errcode='P0001';
    end if;
    if v_product.expiration_mode='SHELF_LIFE'
      and private.pos_cad6_shelf_life_expired_for_sale(v_product)
    then
      raise exception 'SHELF_LIFE_EXPIRED_BLOCKED' using errcode='P0001';
    end if;

    v_recipe_ingredient := false;
    if v_source_type='recipe' and v_source_id is not null
      and pg_catalog.strpos(v_line_id,'::rest_inv5::') > 0
    then
      select * into v_source from public.pos_products p
        where p.license_id=p_license_id and p.id=v_source_id
          and p.deleted_at is null and p.is_active=true;
      if v_source.id is not null and pg_catalog.jsonb_typeof(v_source.recipe)='array' then
        select exists(
          select 1 from pg_catalog.jsonb_array_elements(v_source.recipe) as ingredient
          where coalesce(ingredient->>'ingredientId',ingredient->>'productId')=v_id
            and coalesce(nullif(ingredient->>'quantity','')::numeric,0)>0
        ) into v_recipe_ingredient;
      end if;
    end if;

    if v_recipe_ingredient and v_product.product_type is distinct from 'ingredient' then
      raise exception 'DIRECT_PARTIAL_NOT_AN_INGREDIENT:%',v_id using errcode='P0001';
    end if;

    v_pending := v_needed;
    v_consumed := 0;
    if private.product_uses_batches(v_product) or v_product.expiration_mode='STRICT' then
      if v_product.expiration_mode='STRICT' and exists(
        select 1 from public.pos_product_batches b
          where b.license_id=p_license_id and b.product_id=v_id
            and b.deleted_at is null and b.is_active=true
            and b.stock > coalesce(b.committed_stock,0)
            and (b.expiry_date is null or private.is_pos_batch_expired_for_sale(b.expiry_date))
      ) then
        raise exception 'STRICT_EXPIRED_BATCH_BLOCKED' using errcode='P0001';
      end if;
      for v_batch in select b.* from public.pos_product_batches b
        where b.license_id=p_license_id and b.product_id=v_id
          and b.deleted_at is null and b.is_active=true and b.track_stock=true
          and ((v_product.expiration_mode <> 'STRICT' and b.expiry_date is null)
               or (b.expiry_date is not null and not private.is_pos_batch_expired_for_sale(b.expiry_date)))
        order by b.expiry_date asc nulls last,b.created_at,b.id
        for update
      loop
        if v_batch.stock is null or v_batch.committed_stock is null
          or v_batch.stock < v_batch.committed_stock or v_batch.committed_stock < 0
        then
          raise exception 'DIRECT_PARTIAL_BATCH_STOCK_UNKNOWN' using errcode='P0001';
        end if;
        v_available := pg_catalog.greatest(
          v_batch.stock-v_batch.committed_stock-coalesce((v_ledger_batches->>v_batch.id)::numeric,0),0
        );
        if v_available <= 0 or v_pending <= 0 then continue; end if;
        v_excess := pg_catalog.least(v_pending,v_available);
        v_ledger_batches := pg_catalog.jsonb_set(v_ledger_batches,array[v_batch.id],
          pg_catalog.to_jsonb(coalesce((v_ledger_batches->>v_batch.id)::numeric,0)+v_excess),true);
        v_pending := v_pending-v_excess;
        v_consumed := v_consumed+v_excess;
        v_allocations := v_allocations || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'sale_id',p_sale_id,'sale_item_id',v_line_id,'product_id',v_id,'product_name',v_product.name,
          'batch_id',v_batch.id,'batch_sku',v_batch.sku,
          'batch_expiry_date',v_batch.expiry_date,'quantity',v_excess,
          'unit_cost',coalesce(v_cost,v_batch.cost,v_product.cost),'stock_source','batch'
        ));
      end loop;
    else
      v_available := pg_catalog.greatest(
        v_product.stock-v_product.committed_stock-coalesce((v_ledger_products->>v_id)::numeric,0),0
      );
      v_consumed := pg_catalog.least(v_needed,v_available);
      v_pending := v_needed-v_consumed;
      if v_consumed > 0 then
        v_ledger_products := pg_catalog.jsonb_set(v_ledger_products,array[v_id],
          pg_catalog.to_jsonb(coalesce((v_ledger_products->>v_id)::numeric,0)+v_consumed),true);
        v_allocations := v_allocations || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'sale_id',p_sale_id,'sale_item_id',v_line_id,'product_id',v_id,'product_name',v_product.name,
          'batch_id',null,'quantity',v_consumed,
          'unit_cost',coalesce(v_cost,v_product.cost),'stock_source','product'
        ));
      end if;
    end if;

    v_missing := pg_catalog.greatest(v_needed-v_consumed,0);
    if v_missing > 0 and not v_recipe_ingredient then
      raise exception 'DIRECT_PARTIAL_STRICT_STOCK_REQUIRED:%',v_id using errcode='P0001';
    end if;
    v_component := coalesce(v_summary->v_id,pg_catalog.jsonb_build_object(
      'ingredient_id',v_id,'ingredient_name',v_product.name,
      'unit',coalesce(nullif(v_metadata->>'componentUnit',''),v_product.metadata->>'unit','pza'),
      'required',0,'consumed',0,'missing',0
    ));
    v_summary := pg_catalog.jsonb_set(v_summary,array[v_id],v_component || pg_catalog.jsonb_build_object(
      'required',coalesce((v_component->>'required')::numeric,0)+v_needed,
      'consumed',coalesce((v_component->>'consumed')::numeric,0)+v_consumed,
      'missing',coalesce((v_component->>'missing')::numeric,0)+v_missing
    ),true);
  end loop;

  for v_entry in select key, value from pg_catalog.jsonb_each(v_summary) loop
    v_missing := coalesce((v_entry.value->>'missing')::numeric,0);
    if v_missing > coalesce((v_approval->'maxMissing'->>v_entry.key)::numeric,0)+0.00001
    then
      raise exception 'DIRECT_PARTIAL_STOCK_CHANGED_RECONFIRM:%',v_entry.key using errcode='P0001';
    end if;
  end loop;
  perform pg_catalog.set_config('lanzo.direct_partial_summary_v1',v_summary::text,true);
  return pg_catalog.jsonb_build_object('ok',true,'success',true,
    'inventory_effect_status','applied','allocations',v_allocations);
end;
$$;

-- Existing function called by the cashier inventory RPC. Strict paths unchanged.
create or replace function private.resolve_sale_inventory_allocations(
  p_license_id uuid,p_items jsonb,p_sale_id text
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog,public,private,pg_temp
as $$
declare
  v_expanded_items jsonb;
  v_response jsonb;
  v_context jsonb := nullif(pg_catalog.current_setting('lanzo.direct_partial_recipe_v1',true),'')::jsonb;
begin
  v_expanded_items := private.rest_inv5_expand_sale_inventory_items(p_license_id,p_items,p_sale_id);
  if v_context is not null then
    v_response := private.resolve_direct_partial_inventory_v1(p_license_id,v_expanded_items,p_sale_id);
  else
    v_response := private.resolve_sale_inventory_allocations_direct_rest_inv5(p_license_id,v_expanded_items,p_sale_id);
  end if;
  return private.rest_inv5_enrich_inventory_allocations(v_expanded_items,v_response);
end;
$$;

-- The current financial dispatcher calls this RPC, then the R2B unlimited
-- cashier, then the original payment+inventory logic. The session GUC is
-- transaction-local and only set after server-side actor/tenant/intent checks.
create or replace function public.pos_create_cloud_sale_cashier_inventory(
  p_license_key text,p_device_fingerprint text,
  p_security_token text default null,p_staff_session_token text default null,
  p_sale jsonb default '{}'::jsonb,p_items jsonb default '[]'::jsonb,
  p_payments jsonb default '[]'::jsonb,p_cash_session_id text default null,
  p_idempotency_key text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_rate_limit jsonb;
  v_context jsonb;
  v_auth jsonb := p_sale->'metadata'->'directPartialInventoryAuthorization';
  v_response jsonb;
  v_summary jsonb;
  v_sale_id text;
begin
  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := p_license_key,p_device_fingerprint := p_device_fingerprint,
    p_staff_session_token := p_staff_session_token,
    p_rpc_name := 'pos_create_cloud_sale_cashier_inventory',
    p_scope := 'POS_WRITE',p_max_attempts := 60,
    p_window_seconds := 600,p_block_seconds := 300,
    p_code := 'RPC_RATE_LIMITED',p_metadata := '{}'::jsonb
  );
  if coalesce((v_rate_limit->>'allowed')::boolean,false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate_limit);
  end if;
  perform private.assert_cash_sale_station_for_request_v1(
    p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_cash_session_id
  );
  perform private.assert_restaurant_sale_dispatcher_context_v1(
    p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,
    p_sale,p_cash_session_id,p_idempotency_key,'sale.cashier_inventory'
  );
  if v_auth is not null then
    v_context := private.validate_pos_sync_context(
      p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token
    );
    perform private.assert_pos_permission(v_context,'pos');
    v_sale_id := nullif(p_sale->>'id','');
    if pg_catalog.jsonb_typeof(v_auth) is distinct from 'object'
      or coalesce((v_auth->>'version')::integer,0) <> 1
      or v_auth->>'mode' is distinct from 'direct_recipe_v1'
      or v_auth->>'saleId' is distinct from v_sale_id
      or nullif(v_auth->>'attemptId','') is null
      or v_auth->>'actorKey' is distinct from v_context->>'actor_key'
      or nullif(p_idempotency_key,'') is null
      or v_sale_id is null
      or coalesce(p_sale->>'order_type',p_sale->'metadata'->>'orderType','')='table'
      or coalesce(p_sale->'metadata'->>'restaurantOrderId','') <> ''
      or p_sale ? 'restaurant_settlement'
      or exists(select 1 from public.pos_restaurant_orders o
        where o.license_id=(v_context->>'license_id')::uuid
          and o.deleted_at is null and
          (o.local_order_id=v_sale_id or o.id=v_sale_id or o.sale_id=v_sale_id))
      or exists(select 1 from pg_catalog.jsonb_array_elements(p_items) i
        where coalesce(i->'metadata'->'inventoryReservation'->>'source','')='table')
    then
      raise exception 'DIRECT_PARTIAL_CONTEXT_FORBIDDEN' using errcode='P0001';
    end if;
    perform pg_catalog.set_config('lanzo.direct_partial_recipe_v1',
      pg_catalog.jsonb_build_object(
        'sale_id',v_sale_id,'license_id',v_context->>'license_id',
        'actor_key',v_context->>'actor_key','idempotency_key',p_idempotency_key,
        'approval',v_auth
      )::text,true
    );
  end if;

  v_response := public.pos_create_cloud_sale_cashier_inventory_unlimited(
    p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,
    p_sale,p_items,p_payments,p_cash_session_id,p_idempotency_key
  );
  if v_auth is not null and coalesce((v_response->>'success')::boolean,false) then
    v_summary := nullif(pg_catalog.current_setting('lanzo.direct_partial_summary_v1',true),'')::jsonb;
    if v_summary is not null then
      update public.pos_sales s set
        metadata=coalesce(s.metadata,'{}'::jsonb) ||
          pg_catalog.jsonb_build_object('directPartialInventory',
            pg_catalog.jsonb_build_object(
              'version',1,'actor_key',v_context->>'actor_key',
              'attempt_id',v_auth->>'attemptId',
              'idempotency_key',p_idempotency_key,'components',v_summary
            )),
        server_version=s.server_version+1,updated_at=now()
      where s.license_id=(v_context->>'license_id')::uuid and s.id=v_sale_id;
      if not found then raise exception 'DIRECT_PARTIAL_SALE_NOT_FOUND' using errcode='P0001'; end if;
      perform private.record_pos_sale_audit_event(
        (v_context->>'license_id')::uuid,v_sale_id,
        'sale.direct_recipe_partial_inventory_authorized',
        (v_context->>'device_id')::uuid,
        nullif(v_context->>'staff_user_id','')::uuid,
        v_context->>'actor_key',
        pg_catalog.jsonb_build_object(
          'actor_key',v_context->>'actor_key','attempt_id',v_auth->>'attemptId',
          'idempotency_key',p_idempotency_key,'required_consumed_missing',v_summary
        )
      );
    end if;
  end if;
  return v_response;
end;
$$;
-- Retains the pre-existing EXECUTE ACL of the replaced cashier function.
