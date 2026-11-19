-- FAR-001: preserve Pharmacy sale cost evidence and reconcile the final report.
-- The live functions below predate the versioned report bodies. Patch only
-- their verified definitions in place, preserving ownership, grants and wrappers.
begin;

create function private.far001_financial_pharmacy(p_license_id uuid)
returns boolean language sql stable set search_path = '' as $pharmacy$
  select exists (
    select 1 from public.business_profiles b
    where b.license_id = p_license_id
      and 'farmacia'::public.business_category = any(b.business_type)
  )
$pharmacy$;

revoke all on function private.far001_financial_pharmacy(uuid)
  from public, anon, authenticated, service_role;

create function private.far001_report_line_cost(p_item public.pos_sale_items)
returns table(cogs numeric, cost_source text)
language sql stable set search_path = '' as $cost$
  with physical as (
    select m.quantity,
           case when m.total_cost > 0 then m.total_cost
                when m.total_cost = 0 and receipt.unit_cost > 0 then m.quantity * receipt.unit_cost
           end as cost,
           coalesce(m.total_cost = 0 and receipt.unit_cost > 0, false) as derived
    from public.pos_inventory_movements m
    left join lateral (
      -- The original positive-cost receipt is evidence for a legacy zero
      -- only while it is the sole stock-in event for this same physical lot.
      select min(r.unit_cost) as unit_cost
      from public.pos_inventory_movements r
      where m.total_cost = 0
        and p_item.unit_cost = 0
        and p_item.metadata->>'r2bCostAuthority' = 'pos_inventory_movements'
        and p_item.metadata->'r2bClientUnitCostIgnored' = 'true'::jsonb
        and m.source = 'sale'
        and m.previous_batch_stock >= m.quantity
        and r.license_id = m.license_id and r.product_id = m.product_id and r.batch_id = m.batch_id
        and r.created_at < m.created_at
        and r.new_batch_stock > r.previous_batch_stock
        and r.movement_type <> 'return_in'
      having count(*) = 1
         and bool_and(r.movement_type = 'manual_in' and r.source = 'inventory_entry'
                     and r.previous_batch_stock = 0 and r.new_batch_stock >= m.previous_batch_stock)
    ) receipt on true
    where m.license_id = p_item.license_id and m.sale_id = p_item.sale_id
      and m.sale_item_id = p_item.id and m.product_id = p_item.product_id
      and m.movement_type = 'sale_out'
  ), coverage as (
    select count(*) as movements, sum(quantity) as units, sum(cost) as total,
           bool_and(quantity > 0 and cost is not null) as complete,
           bool_or(derived) as derived
    from physical
  )
  select
    case when complete and units = p_item.quantity then total
         when movements = 0 and p_item.quantity > 0 and p_item.unit_cost > 0
              and p_item.inventory_effect_status in ('not_required','not_applied')
         then p_item.unit_cost * p_item.quantity end,
    case when complete and units = p_item.quantity then
           case when derived then 'inventory_receipt' else 'inventory_movement' end
         when movements = 0 and p_item.quantity > 0 and p_item.unit_cost > 0
              and p_item.inventory_effect_status in ('not_required','not_applied')
         then 'sale_item_snapshot'
         else 'missing' end
  from coverage
$cost$;

revoke all on function private.far001_report_line_cost(public.pos_sale_items)
  from public, anon, authenticated, service_role;

do $migration$
declare
  definition text;
begin
  select replace(pg_get_functiondef(to_regprocedure('private.resolve_sale_inventory_allocations_direct_rest_inv5(uuid,jsonb,text)')), chr(13), '') into definition;
  if md5(definition) is distinct from '2f07a19b1b7b083b8f6cc98f7f132a9b' then
    raise exception 'FAR001_DEFINITION_DRIFT: %', 'private.resolve_sale_inventory_allocations_direct_rest_inv5(uuid,jsonb,text)';
  end if;
  definition := replace(definition, $before$  v_required_count integer := 0;$before$, $after$  v_required_count integer := 0;
  v_pharmacy boolean := private.far001_financial_pharmacy(p_license_id);$after$);
  definition := replace(definition, $before$coalesce(v_unit_cost, v_product.cost)$before$, $after$case when v_pharmacy then nullif(v_product.cost, 0) else coalesce(v_unit_cost, v_product.cost) end, 'cost_source', case when v_pharmacy and v_product.cost > 0 then 'catalog_at_sale' end$after$);
  definition := replace(definition, $before$coalesce(v_unit_cost, v_batch.cost, v_product.cost)$before$, $after$case when v_pharmacy then nullif(coalesce(v_batch.cost, v_product.cost), 0) else coalesce(v_unit_cost, v_batch.cost, v_product.cost) end, 'cost_source', case when v_pharmacy then case when v_batch.cost > 0 then 'lot_at_sale' when v_batch.cost is null and v_product.cost > 0 then 'catalog_at_sale' end end$after$);
  execute definition;

  select replace(pg_get_functiondef(to_regprocedure('private.apply_sale_inventory_effects_direct_rest_inv5(uuid,text,jsonb,uuid,uuid,text,text,text)')), chr(13), '') into definition;
  if md5(definition) is distinct from 'cf752f88306af0a0b3f06d5a66c4ead3' then
    raise exception 'FAR001_DEFINITION_DRIFT: %', 'private.apply_sale_inventory_effects_direct_rest_inv5(uuid,text,jsonb,uuid,uuid,text,text,text)';
  end if;
  definition := replace(definition, $before$jsonb_build_object('stock_source', 'product', 'phase', 'fase6c_cloud_sales_inventory')$before$, $after$jsonb_build_object('stock_source', 'product', 'phase', 'fase6c_cloud_sales_inventory') || jsonb_strip_nulls(jsonb_build_object('cost_source', v_allocation.payload->>'cost_source'))$after$);
  definition := replace(definition, $before$coalesce((v_allocation.payload->>'fefo')::boolean, false))$before$, $after$coalesce((v_allocation.payload->>'fefo')::boolean, false)) || jsonb_strip_nulls(jsonb_build_object('cost_source', v_allocation.payload->>'cost_source'))$after$);
  execute definition;

  select replace(pg_get_functiondef(to_regprocedure('private.r2b_finalize_inventory_costs_v1(uuid,text)')), chr(13), '') into definition;
  if md5(definition) is distinct from 'faef9bc87a1c6a08b2261f8bc57cd179' then
    raise exception 'FAR001_DEFINITION_DRIFT: %', 'private.r2b_finalize_inventory_costs_v1(uuid,text)';
  end if;
  definition := replace(definition, $before$round(sum(coalesce(m.total_cost, 0)) / nullif(sum(m.quantity), 0), 4)$before$, $after$case when not private.far001_financial_pharmacy(p_license_id) or count(m.total_cost) = count(*)
                then round(sum(coalesce(m.total_cost, 0)) / nullif(sum(m.quantity), 0), 4) end$after$);
  definition := replace(definition, $before$and costs.weighted_unit_cost is not null;$before$, $after$and (costs.weighted_unit_cost is not null or private.far001_financial_pharmacy(p_license_id));$after$);
  execute definition;

  select replace(pg_get_functiondef(to_regprocedure('public.pos_get_sales_final_overview_unlimited(text,text,text,text,timestamp with time zone,timestamp with time zone,text,uuid,uuid,text,text,text,text)')), chr(13), '') into definition;
  if md5(definition) is distinct from '7d08f72a08e93db6590d8a5e67de8117' then
    raise exception 'FAR001_DEFINITION_DRIFT: %', 'public.pos_get_sales_final_overview_unlimited(text,text,text,text,timestamp with time zone,timestamp with time zone,text,uuid,uuid,text,text,text,text)';
  end if;
  definition := replace(definition, $before$  v_profit_status text := 'definitive';$before$, $after$  v_profit_status text := 'definitive';
  v_pharmacy boolean;$after$);
  definition := replace(definition, $before$  v_license_id := (v_context->>'license_id')::uuid;$before$, $after$  v_license_id := (v_context->>'license_id')::uuid;
  v_pharmacy := private.far001_financial_pharmacy(v_license_id);$after$);
  definition := replace(definition, $before$  ), item_costs as ($before$, $after$  ), pharmacy_initial as (
    select
      sum(s.amount_paid) as paid,
      sum(s.total - s.amount_paid) as originated,
      count(*) filter (where s.amount_paid is null or s.amount_paid < 0 or s.amount_paid > s.total
        or s.amount_paid <> coalesce(t.paid, 0)
        or coalesce(t.unknown, false)) as missing_paid,
      count(*) filter (where s.amount_paid is null or s.amount_paid < 0 or s.amount_paid > s.total
        or (s.amount_paid < s.total and s.credit_effect_status is distinct from 'applied')
        or (s.amount_paid = s.total and s.credit_effect_status is distinct from 'not_applied'
            and s.credit_effect_status is distinct from 'not_required')) as missing_credit
    from net_sales s
    left join lateral (
      select sum(p.amount) filter (where p.family in ('cash','card','transfer')) as paid,
             bool_or(p.family not in ('cash','card','transfer','credit') or p.amount < 0) as unknown
      from payment_rows p where p.sale_id = s.id
    ) t on true
    where v_pharmacy
  ), item_costs as ($after$);
  definition := replace(definition, $before$           case
             when im.has_movement_cost then 'inventory_movement'
             when i.unit_cost is not null then 'sale_item_snapshot'
             else 'missing'
           end as cost_source,
           case
             when im.has_movement_cost then coalesce(im.movement_cost, 0)
             when i.unit_cost is not null then coalesce(i.unit_cost, 0) * coalesce(i.quantity, 0)
             else null
           end as cogs$before$, $after$           case when v_pharmacy then fc.cost_source
             when im.has_movement_cost then 'inventory_movement'
             when i.unit_cost is not null then 'sale_item_snapshot'
             else 'missing'
           end as cost_source,
           case when v_pharmacy then fc.cogs
             when im.has_movement_cost then coalesce(im.movement_cost, 0)
             when i.unit_cost is not null then coalesce(i.unit_cost, 0) * coalesce(i.quantity, 0)
             else null
           end as cogs$after$);
  definition := replace(definition, $before$    left join lateral (
      select coalesce(sum(m.total_cost) filter (where m.total_cost is not null), 0) as movement_cost,
             count(*) filter (where m.total_cost is not null) > 0 as has_movement_cost
      from public.pos_inventory_movements m
      where m.license_id = i.license_id
        and m.sale_id = i.sale_id
        and m.sale_item_id = i.id
        and m.movement_type = 'sale_out'
    ) im on true$before$, $after$    left join lateral (
      select coalesce(sum(m.total_cost) filter (where m.total_cost is not null), 0) as movement_cost,
             count(*) filter (where m.total_cost is not null) > 0 as has_movement_cost
      from public.pos_inventory_movements m
      where m.license_id = i.license_id
        and m.sale_id = i.sale_id
        and m.sale_item_id = i.id
        and m.movement_type = 'sale_out'
    ) im on true
    left join lateral private.far001_report_line_cost(i) fc on v_pharmacy$after$);
  definition := replace(definition, $before$      and (p_product_id is null or i.product_id = p_product_id)
      and (p_category_id is null or i.category_id = p_category_id)
  ), gross_agg$before$, $after$      and (v_pharmacy or p_product_id is null or i.product_id = p_product_id)
      and (v_pharmacy or p_category_id is null or i.category_id = p_category_id)
  ), cost_gaps as (
    select count(*) as missing_sales from net_sales s
    where v_pharmacy and not exists (select 1 from item_costs i where i.sale_id = s.id)
  ), gross_agg$after$);
  definition := replace(definition, $before$           greatest(
             coalesce(sum(l.amount) filter$before$, $after$           coalesce(sum(-l.amount) filter (where l.sale_id is null and l.type in ('PAYMENT','CANCEL_PAYMENT')), 0) as later_paid,
           count(*) filter (where l.sale_id is null and l.type in ('PAYMENT','CANCEL_PAYMENT')
             and (l.amount is null or (l.type = 'PAYMENT' and l.amount >= 0)
               or (l.type = 'CANCEL_PAYMENT' and l.amount <= 0))) as missing_later,
           greatest(
             coalesce(sum(l.amount) filter$after$);
  definition := replace(definition, $before$    'cogs_total', co.cogs_total,$before$, $after$    'cogs_total', case when not v_pharmacy or co.cogs_missing_count + cg.missing_sales = 0 then co.cogs_total end,
    'far_initial_paid', case when v_pharmacy and fi.missing_paid = 0 then coalesce(fi.paid, 0) end,
    'far_originated_credit', case when v_pharmacy and fi.missing_paid = 0 and fi.missing_credit = 0 then coalesce(fi.originated, 0) end,
    'far_later_paid', case when v_pharmacy and cr.missing_later = 0 and p_product_id is null and p_category_id is null
      and (p_device_id is null or p_device_id = v_context_device_id and v_scope in ('mine','self') and v_own_staff is null)
      then cr.later_paid end,$after$);
  definition := replace(definition, $before$    'cogs_missing_count', co.cogs_missing_count,$before$, $after$    'cogs_missing_count', co.cogs_missing_count + cg.missing_sales,$after$);
  definition := replace(definition, $before$    'gross_profit_total', n.net_sales_total - co.cogs_total,$before$, $after$    'gross_profit_total', case when not v_pharmacy or co.cogs_missing_count + cg.missing_sales = 0 then n.net_sales_total - co.cogs_total end,$after$);
  definition := replace(definition, $before$    'gross_margin_percent', case when n.net_sales_total > 0$before$, $after$    'gross_margin_percent', case when v_pharmacy and (co.cogs_missing_count + cg.missing_sales > 0 or n.net_sales_total = 0) then null when n.net_sales_total > 0$after$);
  definition := replace(definition, $before$co.cogs_missing_count > 0 then 'incomplete'$before$, $after$co.cogs_missing_count + cg.missing_sales > 0 then 'incomplete'$after$);
  definition := replace(definition, $before$  from gross_agg g, cancelled_agg ca, net_agg n, payment_agg p, cost_agg co, credit_agg cr, debt_agg d, inventory_agg ia, product_inventory_agg pi, cash_agg ch, cash_session_agg cs;$before$, $after$  from gross_agg g, cancelled_agg ca, net_agg n, payment_agg p, cost_agg co, credit_agg cr, debt_agg d, inventory_agg ia, product_inventory_agg pi, cash_agg ch, cash_session_agg cs, cost_gaps cg, pharmacy_initial fi;

  if v_pharmacy then
    v_overview := v_overview || jsonb_build_object(
      'financial_coverage_version', 1,
      'initial_collected_total', v_overview->'far_initial_paid',
      'originated_credit_total', v_overview->'far_originated_credit',
      'later_collected_total', v_overview->'far_later_paid',
      'current_debt_scope', case when private.reports_audit_allowed(v_context) then 'license' end,
      'current_debt_total', case when private.reports_audit_allowed(v_context) then v_overview->'customer_debt_total' end
    ) - 'far_initial_paid' - 'far_originated_credit' - 'far_later_paid';
    if not private.reports_audit_allowed(v_context) then
      v_overview := v_overview - 'customer_debt_total' - 'customers_with_debt';
    end if;
  end if;

$after$);
  execute definition;

  select replace(pg_get_functiondef(to_regprocedure('public.pos_get_sales_profit_report_unlimited(text,text,text,text,timestamp with time zone,timestamp with time zone,text,uuid,text,text,integer,integer)')), chr(13), '') into definition;
  if md5(definition) is distinct from '3baf7836ecbff1a4106e0c60d324f819' then
    raise exception 'FAR001_DEFINITION_DRIFT: %', 'public.pos_get_sales_profit_report_unlimited(text,text,text,text,timestamp with time zone,timestamp with time zone,text,uuid,text,text,integer,integer)';
  end if;
  definition := replace(definition, $before$  v_context jsonb;$before$, $after$  v_context jsonb;
  v_pharmacy boolean;$after$);
  definition := replace(definition, $before$  v_license_id := (v_context->>'license_id')::uuid;$before$, $after$  v_license_id := (v_context->>'license_id')::uuid;
  v_pharmacy := private.far001_financial_pharmacy(v_license_id);$after$);
  definition := replace(definition, $before$case when im.has_movement_cost then coalesce(im.movement_cost, 0)$before$, $after$case when v_pharmacy then fc.cogs when im.has_movement_cost then coalesce(im.movement_cost, 0)$after$);
  definition := replace(definition, $before$case when im.has_movement_cost then 'inventory_movement'$before$, $after$case when v_pharmacy then fc.cost_source when im.has_movement_cost then 'inventory_movement'$after$);
  definition := replace(definition, $before$    left join lateral (
      select coalesce(sum(m.total_cost) filter (where m.total_cost is not null), 0) as movement_cost,
             count(*) filter (where m.total_cost is not null) > 0 as has_movement_cost
      from public.pos_inventory_movements m
      where m.license_id = i.license_id
        and m.sale_id = i.sale_id
        and m.sale_item_id = i.id
        and m.movement_type = 'sale_out'
    ) im on true$before$, $after$    left join lateral (
      select coalesce(sum(m.total_cost) filter (where m.total_cost is not null), 0) as movement_cost,
             count(*) filter (where m.total_cost is not null) > 0 as has_movement_cost
      from public.pos_inventory_movements m
      where m.license_id = i.license_id
        and m.sale_id = i.sale_id
        and m.sale_item_id = i.id
        and m.movement_type = 'sale_out'
    ) im on true
    left join lateral private.far001_report_line_cost(i) fc on v_pharmacy$after$);
  definition := replace(definition, $before$'unit_cost', unit_cost,$before$, $after$'unit_cost', case when v_pharmacy then cogs / nullif(quantity, 0) else unit_cost end,$after$);
  definition := replace(definition, $before$'cogs', coalesce(cogs, 0),$before$, $after$'cogs', case when v_pharmacy then cogs else coalesce(cogs, 0) end,$after$);
  definition := replace(definition, $before$'gross_profit', line_total - coalesce(cogs, 0),$before$, $after$'gross_profit', line_total - case when v_pharmacy then cogs else coalesce(cogs, 0) end,$after$);
  definition := replace(definition, $before$'gross_margin_percent', case when line_total > 0$before$, $after$'gross_margin_percent', case when v_pharmacy and cogs is null then null when line_total > 0$after$);
  definition := replace(definition, $before$cost_source = 'sale_item_snapshot' then 'estimated'$before$, $after$cost_source in ('sale_item_snapshot','inventory_receipt') then 'estimated'$after$);
  execute definition;
end;
$migration$;

commit;
