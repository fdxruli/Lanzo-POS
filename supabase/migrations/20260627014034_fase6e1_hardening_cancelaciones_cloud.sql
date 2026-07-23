-- FASE 6E.1 — Hardening de cancelaciones cloud PRO
-- Preview/dry-run seguro, wrapper preventivo, auditoria de bloqueos y diagnostico post-cancelacion.

create or replace function public.pos_preview_cloud_sale_cancellation(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_sale_id text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_actor_key text;
  v_actor_name text;
  v_permissions jsonb;
  v_sale_id text := nullif(btrim(coalesce(p_sale_id, '')), '');
  v_sale public.pos_sales;
  v_sale_folio text;
  v_block_reasons jsonb := '[]'::jsonb;
  v_can_cancel boolean := true;
  v_requires_specific_permission boolean := false;
  v_has_specific_permission boolean := false;
  v_has_global_permission boolean := false;

  v_cash_original_count integer := 0;
  v_cash_original_amount numeric := 0;
  v_cash_original_movements jsonb := '[]'::jsonb;
  v_cash_missing_session_count integer := 0;
  v_cash_session_ids jsonb := '[]'::jsonb;
  v_sale_cash_component numeric := 0;
  v_sale_non_cash_component numeric := 0;

  v_inventory_original_count integer := 0;
  v_inventory_original_quantity numeric := 0;
  v_inventory_original_movements jsonb := '[]'::jsonb;
  v_inventory_missing_product_count integer := 0;
  v_inventory_missing_batch_count integer := 0;

  v_customer public.pos_customers;
  v_charge public.pos_customer_ledger;
  v_payment public.pos_customer_ledger;
  v_credit_debt_before numeric := 0;
  v_credit_debt_after numeric := 0;
  v_credit_reversal_amount numeric := 0;
  v_subsequent_payment_count integer := 0;
  v_subsequent_payments jsonb := '[]'::jsonb;
  v_credit_required boolean := false;
  v_cash_required boolean := false;
  v_inventory_required boolean := false;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_cancellations_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'pos');

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_actor_name := private.resolve_cash_actor_name(v_context);
  v_permissions := coalesce(v_context->'staff_permissions', '{}'::jsonb);

  if v_sale_id is null then
    return jsonb_build_object(
      'success', false,
      'can_cancel', false,
      'code', 'SALE_ID_REQUIRED',
      'message', 'La venta a cancelar es obligatoria.',
      'block_reasons', jsonb_build_array(jsonb_build_object('code', 'SALE_ID_REQUIRED', 'message', 'La venta a cancelar es obligatoria.')),
      'mode', 'cloud_sale_cancellation_preview'
    );
  end if;

  select * into v_sale
  from public.pos_sales s
  where s.license_id = v_license_id
    and s.id = v_sale_id
  limit 1;

  if v_sale.id is null then
    return jsonb_build_object(
      'success', false,
      'can_cancel', false,
      'code', 'SALE_NOT_FOUND',
      'message', 'Venta no encontrada.',
      'block_reasons', jsonb_build_array(jsonb_build_object('code', 'SALE_NOT_FOUND', 'message', 'Venta no encontrada.')),
      'mode', 'cloud_sale_cancellation_preview',
      'actor', jsonb_build_object('actor_key', v_actor_key, 'actor_name', v_actor_name, 'device_id', v_device_id, 'staff_user_id', v_staff_user_id)
    );
  end if;

  v_sale_folio := coalesce(v_sale.cloud_folio, v_sale.folio, v_sale.local_folio, v_sale.id);

  if v_sale.source_mode <> 'cloud_committed' then
    v_block_reasons := v_block_reasons || jsonb_build_array(jsonb_build_object('code', 'SALE_NOT_CLOUD_COMMITTED', 'message', 'Esta venta no fue confirmada en cloud.'));
  end if;

  if v_sale.status = 'cancelled' or v_sale.cancelled_at is not null then
    v_block_reasons := v_block_reasons || jsonb_build_array(jsonb_build_object('code', 'SALE_ALREADY_CANCELLED', 'message', 'La venta ya fue cancelada anteriormente.'));
  elsif v_sale.status <> 'closed' then
    v_block_reasons := v_block_reasons || jsonb_build_array(jsonb_build_object('code', 'SALE_NOT_CLOSED', 'message', 'Solo se pueden cancelar ventas cerradas.'));
  end if;

  if coalesce(v_context->>'device_role', 'staff') = 'staff' then
    v_requires_specific_permission := (v_permissions ? 'sales_cancellations') or (v_permissions ? 'cancel_sales');
    v_has_specific_permission := coalesce((v_permissions->>'sales_cancellations')::boolean, false)
      or coalesce((v_permissions->>'cancel_sales')::boolean, false);
    v_has_global_permission := coalesce((v_permissions->>'reports')::boolean, false)
      or coalesce((v_permissions->>'sales_cancellations_global')::boolean, false)
      or coalesce((v_permissions->>'all_sales')::boolean, false);

    if v_requires_specific_permission and not v_has_specific_permission then
      v_block_reasons := v_block_reasons || jsonb_build_array(jsonb_build_object('code', 'POS_PERMISSION_DENIED:sales_cancellations', 'message', 'No tienes permiso para cancelar ventas.'));
    end if;

    if v_sale.staff_user_id is distinct from v_staff_user_id and not v_has_global_permission then
      v_block_reasons := v_block_reasons || jsonb_build_array(jsonb_build_object('code', 'SALE_CANCELLATION_FORBIDDEN', 'message', 'No tienes permiso para cancelar esta venta.'));
    end if;
  end if;

  v_sale_cash_component := coalesce(nullif(v_sale.metadata #>> '{payment_summary,cash_component}', '')::numeric, 0);
  v_sale_non_cash_component := coalesce(nullif(v_sale.metadata #>> '{payment_summary,non_cash_component}', '')::numeric, 0);

  select
    count(*)::integer,
    coalesce(sum(abs(cm.amount)), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', cm.id,
      'type', cm.type,
      'source', cm.source,
      'cash_session_id', cm.cash_session_id,
      'amount', abs(cm.amount),
      'concept', cm.concept,
      'customer_ledger_id', cm.customer_ledger_id,
      'created_at', cm.created_at
    ) order by cm.created_at asc, cm.id asc), '[]'::jsonb)
  into v_cash_original_count, v_cash_original_amount, v_cash_original_movements
  from public.pos_cash_movements cm
  where cm.license_id = v_license_id
    and cm.sale_id = v_sale.id
    and cm.deleted_at is null
    and cm.type in ('venta', 'venta_efectivo', 'abono_cliente')
    and cm.source not in ('sale_cancellation', 'sale_credit_cancellation');

  select count(*)::integer
  into v_cash_missing_session_count
  from public.pos_cash_movements cm
  left join public.pos_cash_sessions s
    on s.license_id = cm.license_id
   and s.id = cm.cash_session_id
   and s.deleted_at is null
  where cm.license_id = v_license_id
    and cm.sale_id = v_sale.id
    and cm.deleted_at is null
    and cm.type in ('venta', 'venta_efectivo', 'abono_cliente')
    and cm.source not in ('sale_cancellation', 'sale_credit_cancellation')
    and s.id is null;

  select coalesce(jsonb_agg(distinct cm.cash_session_id), '[]'::jsonb)
  into v_cash_session_ids
  from public.pos_cash_movements cm
  where cm.license_id = v_license_id
    and cm.sale_id = v_sale.id
    and cm.deleted_at is null
    and cm.cash_session_id is not null;

  v_cash_required := v_sale.cash_session_id is not null or v_cash_original_count > 0;

  if v_cash_required and v_cash_missing_session_count > 0 then
    v_block_reasons := v_block_reasons || jsonb_build_array(jsonb_build_object('code', 'CASH_SESSION_NOT_FOUND', 'message', 'No se encontro una caja original de la venta.'));
  end if;

  select
    count(*)::integer,
    coalesce(sum(im.quantity), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', im.id,
      'product_id', im.product_id,
      'batch_id', im.batch_id,
      'sale_item_id', im.sale_item_id,
      'quantity', im.quantity,
      'unit_cost', im.unit_cost,
      'created_at', im.created_at
    ) order by im.created_at asc, im.id asc), '[]'::jsonb)
  into v_inventory_original_count, v_inventory_original_quantity, v_inventory_original_movements
  from public.pos_inventory_movements im
  where im.license_id = v_license_id
    and im.sale_id = v_sale.id
    and im.movement_type = 'sale_out';

  select count(*)::integer
  into v_inventory_missing_product_count
  from public.pos_inventory_movements im
  left join public.pos_products p
    on p.license_id = im.license_id
   and p.id = im.product_id
   and p.deleted_at is null
  where im.license_id = v_license_id
    and im.sale_id = v_sale.id
    and im.movement_type = 'sale_out'
    and p.id is null;

  select count(*)::integer
  into v_inventory_missing_batch_count
  from public.pos_inventory_movements im
  left join public.pos_product_batches b
    on b.license_id = im.license_id
   and b.id = im.batch_id
   and b.product_id = im.product_id
   and b.deleted_at is null
  where im.license_id = v_license_id
    and im.sale_id = v_sale.id
    and im.movement_type = 'sale_out'
    and im.batch_id is not null
    and b.id is null;

  v_inventory_required := coalesce(v_sale.inventory_effect_status, 'not_applied') = 'applied' or v_inventory_original_count > 0;

  if v_inventory_required and v_inventory_missing_product_count > 0 then
    v_block_reasons := v_block_reasons || jsonb_build_array(jsonb_build_object('code', 'PRODUCT_NOT_SYNCED_FOR_CLOUD_SALE', 'message', 'No se encontro un producto cloud para devolver inventario.'));
  end if;

  if v_inventory_required and v_inventory_missing_batch_count > 0 then
    v_block_reasons := v_block_reasons || jsonb_build_array(jsonb_build_object('code', 'CLOUD_BATCH_NOT_AVAILABLE', 'message', 'No se encontro un lote cloud para devolver inventario.'));
  end if;

  v_credit_required := coalesce(v_sale.credit_effect_status, 'not_applied') = 'applied'
    or v_sale.credit_ledger_charge_id is not null
    or v_sale.credit_ledger_payment_id is not null;

  if v_credit_required then
    if v_sale.customer_id is null then
      v_block_reasons := v_block_reasons || jsonb_build_array(jsonb_build_object('code', 'CREDIT_SALE_CUSTOMER_REQUIRED', 'message', 'La venta fiada no tiene cliente ligado.'));
    else
      select * into v_customer
      from public.pos_customers c
      where c.license_id = v_license_id
        and c.id = v_sale.customer_id
      limit 1;

      if v_customer.id is null then
        v_block_reasons := v_block_reasons || jsonb_build_array(jsonb_build_object('code', 'CUSTOMER_NOT_FOUND', 'message', 'No se encontro el cliente de la venta fiada.'));
      end if;

      select * into v_charge
      from public.pos_customer_ledger l
      where l.license_id = v_license_id
        and l.deleted_at is null
        and (
          (v_sale.credit_ledger_charge_id is not null and l.id = v_sale.credit_ledger_charge_id)
          or (v_sale.credit_ledger_charge_id is null and l.sale_id = v_sale.id and l.type = 'CHARGE')
        )
      order by l.created_at asc
      limit 1;

      if v_charge.id is null then
        v_block_reasons := v_block_reasons || jsonb_build_array(jsonb_build_object('code', 'CREDIT_CHARGE_LEDGER_NOT_FOUND', 'message', 'No se encontro el cargo de credito de la venta.'));
      end if;

      select * into v_payment
      from public.pos_customer_ledger l
      where l.license_id = v_license_id
        and l.deleted_at is null
        and (
          (v_sale.credit_ledger_payment_id is not null and l.id = v_sale.credit_ledger_payment_id)
          or (v_sale.credit_ledger_payment_id is null and l.sale_id = v_sale.id and l.type = 'PAYMENT')
        )
      order by l.created_at asc
      limit 1;

      select coalesce(sum(l.amount), 0)
      into v_credit_debt_before
      from public.pos_customer_ledger l
      where l.license_id = v_license_id
        and l.customer_id = v_sale.customer_id
        and l.deleted_at is null;

      select
        count(*)::integer,
        coalesce(jsonb_agg(jsonb_build_object(
          'id', q.id,
          'amount', abs(q.amount),
          'payment_method', q.payment_method,
          'reference_type', q.reference_type,
          'reference_id', q.reference_id,
          'cash_session_id', q.cash_session_id,
          'created_at', q.created_at,
          'note', q.note
        ) order by q.created_at asc, q.id asc), '[]'::jsonb)
      into v_subsequent_payment_count, v_subsequent_payments
      from (
        select l.*
        from public.pos_customer_ledger l
        where l.license_id = v_license_id
          and l.customer_id = v_sale.customer_id
          and l.deleted_at is null
          and l.type = 'PAYMENT'
          and l.amount < 0
          and coalesce(l.sale_id, '') <> v_sale.id
          and coalesce(l.metadata->>'reversal', 'false') <> 'true'
          and l.created_at > coalesce(v_charge.created_at, v_sale.committed_at, v_sale.created_at, v_sale.sold_at)
        order by l.created_at asc, l.id asc
        limit 20
      ) q;

      if v_subsequent_payment_count > 0 then
        v_block_reasons := v_block_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'SALE_HAS_SUBSEQUENT_CUSTOMER_PAYMENTS',
          'message', 'La venta fiada tiene abonos posteriores independientes. No se cancelo automaticamente para evitar descuadrar la deuda.',
          'payment_count', v_subsequent_payment_count
        ));
      end if;

      if v_charge.id is not null then
        v_credit_debt_after := v_credit_debt_before + coalesce(abs(v_payment.amount), 0) - abs(v_charge.amount);
        if v_credit_debt_after < -0.005 then
          v_block_reasons := v_block_reasons || jsonb_build_array(jsonb_build_object('code', 'CUSTOMER_DEBT_NEGATIVE_AFTER_CANCEL', 'message', 'La deuda del cliente quedaria negativa despues de cancelar.'));
        end if;
        v_credit_debt_after := greatest(v_credit_debt_after, 0);
        v_credit_reversal_amount := greatest(abs(v_charge.amount) - coalesce(abs(v_payment.amount), 0), 0);
      end if;
    end if;
  end if;

  v_can_cancel := jsonb_array_length(v_block_reasons) = 0;

  return jsonb_build_object(
    'success', true,
    'can_cancel', v_can_cancel,
    'code', case when v_can_cancel then 'OK' else coalesce(v_block_reasons #>> '{0,code}', 'CLOUD_SALE_CANCELLATION_BLOCKED') end,
    'message', case when v_can_cancel then 'La venta puede cancelarse de forma segura.' else 'La venta no puede cancelarse automaticamente.' end,
    'sale', private.pos_sale_to_jsonb(v_sale),
    'folio', v_sale_folio,
    'reason_previewed', v_reason,
    'block_reasons', v_block_reasons,
    'preview', jsonb_build_object(
      'cash', jsonb_build_object(
        'required', v_cash_required,
        'original_movement_count', v_cash_original_count,
        'reversal_amount', v_cash_original_amount,
        'sale_total_decrement', case when coalesce(v_sale.credit_effect_status, 'not_applied') <> 'applied' then coalesce(v_sale.total, 0) else 0 end,
        'cash_component', v_sale_cash_component,
        'non_cash_component', v_sale_non_cash_component,
        'cash_session_ids', v_cash_session_ids,
        'movements', v_cash_original_movements
      ),
      'inventory', jsonb_build_object(
        'required', v_inventory_required,
        'original_movement_count', v_inventory_original_count,
        'return_quantity', v_inventory_original_quantity,
        'movements', v_inventory_original_movements
      ),
      'credit', jsonb_build_object(
        'required', v_credit_required,
        'customer_id', v_sale.customer_id,
        'customer_name', coalesce(v_customer.name, v_sale.customer_name),
        'charge_ledger_id', v_charge.id,
        'payment_ledger_id', v_payment.id,
        'debt_before', v_credit_debt_before,
        'debt_after_preview', v_credit_debt_after,
        'reversal_amount', v_credit_reversal_amount,
        'subsequent_payment_count', v_subsequent_payment_count,
        'subsequent_payments', v_subsequent_payments
      )
    ),
    'actor', jsonb_build_object('actor_key', v_actor_key, 'actor_name', v_actor_name, 'device_id', v_device_id, 'staff_user_id', v_staff_user_id),
    'mode', 'cloud_sale_cancellation_preview'
  );
end;
$function$;

-- Conservar la implementacion 6E como motor interno y colocar un wrapper preventivo delante.
do $$
begin
  if to_regprocedure('public.pos_cancel_cloud_sale(text,text,text,text,text,text,text)') is not null
     and to_regprocedure('public.pos_cancel_cloud_sale_apply_fase6e(text,text,text,text,text,text,text)') is null then
    execute 'alter function public.pos_cancel_cloud_sale(text,text,text,text,text,text,text) rename to pos_cancel_cloud_sale_apply_fase6e';
  end if;
end $$;

create or replace function public.pos_cancel_cloud_sale(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_sale_id text default null,
  p_reason text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_preview jsonb;
  v_reasons jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_first_code text;
  v_sale_id text := nullif(btrim(coalesce(p_sale_id, '')), '');
  v_actor jsonb;
begin
  v_preview := public.pos_preview_cloud_sale_cancellation(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    p_sale_id,
    p_reason
  );

  v_reasons := coalesce(v_preview->'block_reasons', '[]'::jsonb);

  if v_reason is null then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
      'code', 'CLOUD_SALE_CANCELLATION_REASON_REQUIRED',
      'message', 'Indica el motivo de cancelacion.'
    ));
  end if;

  if coalesce((v_preview->>'success')::boolean, false) is not true
     or coalesce((v_preview->>'can_cancel')::boolean, false) is not true
     or jsonb_array_length(v_reasons) > 0 then
    v_first_code := coalesce(v_reasons #>> '{0,code}', v_preview->>'code', 'CLOUD_SALE_CANCELLATION_BLOCKED');
    v_actor := coalesce(v_preview->'actor', '{}'::jsonb);

    if v_sale_id is not null and coalesce((v_preview->>'success')::boolean, false) is true then
      perform private.record_pos_sale_audit_event(
        ((v_preview->'sale'->>'license_id')::uuid),
        v_sale_id,
        'sale.cancel_blocked',
        nullif(v_actor->>'device_id', '')::uuid,
        nullif(v_actor->>'staff_user_id', '')::uuid,
        v_actor->>'actor_name',
        jsonb_build_object(
          'sale_id', v_sale_id,
          'folio', coalesce(v_preview->>'folio', v_preview->'sale'->>'cloud_folio', v_preview->'sale'->>'folio', v_sale_id),
          'reason', v_reason,
          'block_code', v_first_code,
          'block_reasons', v_reasons,
          'preview', v_preview->'preview',
          'idempotency_key', p_idempotency_key,
          'phase', 'fase6e1_hardening_cancelaciones_cloud'
        )
      );
    end if;

    return jsonb_build_object(
      'success', false,
      'can_cancel', false,
      'code', v_first_code,
      'message', case
        when v_first_code = 'SALE_HAS_SUBSEQUENT_CUSTOMER_PAYMENTS' then 'La venta fiada tiene abonos posteriores independientes. No se aplico ningun cambio.'
        when v_first_code = 'CLOUD_SALE_CANCELLATION_REASON_REQUIRED' then 'Indica el motivo de cancelacion.'
        else coalesce(v_preview->>'message', 'No se cancelo la venta para evitar descuadres.')
      end,
      'block_reasons', v_reasons,
      'preview', v_preview,
      'mode', 'cloud_sale_cancellation_blocked'
    );
  end if;

  return public.pos_cancel_cloud_sale_apply_fase6e(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    p_sale_id,
    p_reason,
    p_idempotency_key
  );
end;
$function$;

create or replace function public.pos_validate_cloud_sale_integrity(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_sale_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_sale_id text := nullif(btrim(coalesce(p_sale_id, '')), '');
  v_sale public.pos_sales;
  v_issues jsonb := '[]'::jsonb;
  v_sale_folio text;

  v_original_cash_count integer := 0;
  v_original_cash_amount numeric := 0;
  v_reversal_cash_count integer := 0;
  v_reversal_cash_amount numeric := 0;

  v_sale_out_count integer := 0;
  v_sale_out_qty numeric := 0;
  v_return_in_count integer := 0;
  v_return_in_qty numeric := 0;

  v_charge public.pos_customer_ledger;
  v_payment public.pos_customer_ledger;
  v_cancel_charge_count integer := 0;
  v_cancel_charge_amount numeric := 0;
  v_cancel_payment_count integer := 0;
  v_cancel_payment_amount numeric := 0;
  v_customer_debt numeric := 0;
  v_ledger_debt numeric := 0;
  v_subsequent_payment_count integer := 0;

  v_cancel_count integer := 0;
  v_sale_cancel_event_count integer := 0;
  v_sale_cancellation_event_count integer := 0;
  v_report_event_count integer := 0;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_sync_base_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'pos');

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  if v_sale_id is null then
    return jsonb_build_object('success', false, 'is_valid', false, 'code', 'SALE_ID_REQUIRED', 'issues', jsonb_build_array(jsonb_build_object('code', 'SALE_ID_REQUIRED', 'message', 'La venta es obligatoria.')));
  end if;

  select * into v_sale
  from public.pos_sales s
  where s.license_id = v_license_id
    and s.id = v_sale_id
  limit 1;

  if v_sale.id is null then
    return jsonb_build_object('success', false, 'is_valid', false, 'code', 'SALE_NOT_FOUND', 'issues', jsonb_build_array(jsonb_build_object('code', 'SALE_NOT_FOUND', 'message', 'Venta no encontrada.')));
  end if;

  v_sale_folio := coalesce(v_sale.cloud_folio, v_sale.folio, v_sale.local_folio, v_sale.id);

  if coalesce(v_context->>'device_role', 'staff') = 'staff'
     and not private.has_pos_permission(v_context, 'reports')
     and coalesce(v_sale.staff_user_id, '00000000-0000-0000-0000-000000000000'::uuid) <> coalesce(v_staff_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and coalesce(v_sale.device_id, '00000000-0000-0000-0000-000000000000'::uuid) <> v_device_id then
    raise exception 'POS_PERMISSION_DENIED:sales_audit' using errcode = 'P0001';
  end if;

  if v_sale.source_mode <> 'cloud_committed' then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'SALE_NOT_CLOUD_COMMITTED', 'message', 'La venta no es cloud_committed.'));
  end if;

  if v_sale.status <> 'cancelled' or v_sale.cancelled_at is null then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'SALE_NOT_CANCELLED', 'message', 'La venta aun no esta marcada como cancelada.'));
  end if;

  select count(*)::integer into v_cancel_count
  from public.pos_sale_cancellations c
  where c.license_id = v_license_id
    and c.sale_id = v_sale.id;

  if v_sale.status = 'cancelled' and v_cancel_count = 0 then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'SALE_CANCELLATION_RECORD_MISSING', 'message', 'La venta esta cancelada pero no tiene registro en pos_sale_cancellations.'));
  elsif v_cancel_count > 1 then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'SALE_CANCELLATION_DUPLICATED', 'message', 'La venta tiene mas de un registro de cancelacion.', 'count', v_cancel_count));
  end if;

  select count(*)::integer, coalesce(sum(abs(amount)), 0)
  into v_original_cash_count, v_original_cash_amount
  from public.pos_cash_movements cm
  where cm.license_id = v_license_id
    and cm.sale_id = v_sale.id
    and cm.deleted_at is null
    and cm.type in ('venta', 'venta_efectivo', 'abono_cliente')
    and cm.source not in ('sale_cancellation', 'sale_credit_cancellation');

  select count(*)::integer, coalesce(sum(abs(amount)), 0)
  into v_reversal_cash_count, v_reversal_cash_amount
  from public.pos_cash_movements cm
  where cm.license_id = v_license_id
    and cm.sale_id = v_sale.id
    and cm.deleted_at is null
    and cm.source in ('sale_cancellation', 'sale_credit_cancellation')
    and cm.type in ('cancelacion_venta', 'cancelacion_abono_inicial');

  if v_original_cash_count > 0 and coalesce(v_sale.cash_reversal_status, 'not_required') <> 'applied' then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'CASH_REVERSAL_STATUS_NOT_APPLIED', 'message', 'Hay movimientos de caja originales pero la venta no marca reversa de caja aplicada.'));
  end if;

  if abs(v_original_cash_amount - v_reversal_cash_amount) > 0.05 then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'CASH_REVERSAL_AMOUNT_MISMATCH', 'message', 'El monto revertido en caja no coincide con el original.', 'original', v_original_cash_amount, 'reversed', v_reversal_cash_amount));
  end if;

  select count(*)::integer, coalesce(sum(quantity), 0)
  into v_sale_out_count, v_sale_out_qty
  from public.pos_inventory_movements im
  where im.license_id = v_license_id
    and im.sale_id = v_sale.id
    and im.movement_type = 'sale_out';

  select count(*)::integer, coalesce(sum(quantity), 0)
  into v_return_in_count, v_return_in_qty
  from public.pos_inventory_movements im
  where im.license_id = v_license_id
    and im.sale_id = v_sale.id
    and im.movement_type = 'return_in'
    and im.source = 'sale_cancellation';

  if v_sale_out_count > 0 and coalesce(v_sale.inventory_reversal_status, 'not_required') <> 'applied' then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'INVENTORY_REVERSAL_STATUS_NOT_APPLIED', 'message', 'Hay salidas de inventario pero la venta no marca devolucion aplicada.'));
  end if;

  if abs(v_sale_out_qty - v_return_in_qty) > 0.0001 then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'INVENTORY_REVERSAL_QTY_MISMATCH', 'message', 'La cantidad devuelta a inventario no coincide con la salida original.', 'sale_out_qty', v_sale_out_qty, 'return_in_qty', v_return_in_qty));
  end if;

  if coalesce(v_sale.credit_effect_status, 'not_applied') = 'applied' then
    select * into v_charge
    from public.pos_customer_ledger l
    where l.license_id = v_license_id
      and l.deleted_at is null
      and ((v_sale.credit_ledger_charge_id is not null and l.id = v_sale.credit_ledger_charge_id) or (v_sale.credit_ledger_charge_id is null and l.sale_id = v_sale.id and l.type = 'CHARGE'))
    order by l.created_at asc
    limit 1;

    select * into v_payment
    from public.pos_customer_ledger l
    where l.license_id = v_license_id
      and l.deleted_at is null
      and ((v_sale.credit_ledger_payment_id is not null and l.id = v_sale.credit_ledger_payment_id) or (v_sale.credit_ledger_payment_id is null and l.sale_id = v_sale.id and l.type = 'PAYMENT'))
    order by l.created_at asc
    limit 1;

    select count(*)::integer, coalesce(sum(abs(amount)), 0)
    into v_cancel_charge_count, v_cancel_charge_amount
    from public.pos_customer_ledger l
    where l.license_id = v_license_id
      and l.deleted_at is null
      and l.sale_id = v_sale.id
      and l.type = 'CANCEL_CHARGE';

    select count(*)::integer, coalesce(sum(abs(amount)), 0)
    into v_cancel_payment_count, v_cancel_payment_amount
    from public.pos_customer_ledger l
    where l.license_id = v_license_id
      and l.deleted_at is null
      and l.sale_id = v_sale.id
      and l.type = 'CANCEL_PAYMENT';

    if v_charge.id is null then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'CREDIT_CHARGE_LEDGER_NOT_FOUND', 'message', 'No se encontro el cargo original de credito.'));
    elsif abs(abs(v_charge.amount) - v_cancel_charge_amount) > 0.05 then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'CREDIT_CHARGE_REVERSAL_MISMATCH', 'message', 'La reversa del cargo no coincide con el cargo original.', 'charge', abs(v_charge.amount), 'reversed', v_cancel_charge_amount));
    end if;

    if v_payment.id is not null and abs(abs(v_payment.amount) - v_cancel_payment_amount) > 0.05 then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'CREDIT_PAYMENT_REVERSAL_MISMATCH', 'message', 'La reversa del abono inicial no coincide con el abono original.', 'payment', abs(v_payment.amount), 'reversed', v_cancel_payment_amount));
    end if;

    select count(*)::integer
    into v_subsequent_payment_count
    from public.pos_customer_ledger l
    where l.license_id = v_license_id
      and l.customer_id = v_sale.customer_id
      and l.deleted_at is null
      and l.type = 'PAYMENT'
      and l.amount < 0
      and coalesce(l.sale_id, '') <> v_sale.id
      and coalesce(l.metadata->>'reversal', 'false') <> 'true'
      and l.created_at > coalesce(v_charge.created_at, v_sale.committed_at, v_sale.created_at, v_sale.sold_at);

    if v_subsequent_payment_count > 0 then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'SALE_HAS_SUBSEQUENT_CUSTOMER_PAYMENTS', 'message', 'La venta tiene abonos posteriores independientes.', 'payment_count', v_subsequent_payment_count));
    end if;

    select coalesce(sum(l.amount), 0)
    into v_ledger_debt
    from public.pos_customer_ledger l
    where l.license_id = v_license_id
      and l.customer_id = v_sale.customer_id
      and l.deleted_at is null;

    select coalesce(c.debt, 0)
    into v_customer_debt
    from public.pos_customers c
    where c.license_id = v_license_id
      and c.id = v_sale.customer_id;

    if abs(v_ledger_debt - v_customer_debt) > 0.05 then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'CUSTOMER_DEBT_LEDGER_MISMATCH', 'message', 'La deuda del cliente no coincide con la suma del ledger.', 'customer_debt', v_customer_debt, 'ledger_debt', v_ledger_debt));
    end if;
  end if;

  select count(*)::integer into v_sale_cancel_event_count
  from public.pos_sync_events e
  where e.license_id = v_license_id
    and e.entity_type = 'sale'
    and e.entity_id = v_sale.id
    and e.operation = 'cancel';

  select count(*)::integer into v_sale_cancellation_event_count
  from public.pos_sync_events e
  where e.license_id = v_license_id
    and e.entity_type = 'sale_cancellation'
    and e.entity_id = coalesce(v_sale.cancellation_id, e.entity_id);

  select count(*)::integer into v_report_event_count
  from public.pos_sync_events e
  where e.license_id = v_license_id
    and e.entity_type = 'report'
    and e.operation = 'update'
    and e.metadata->>'sale_id' = v_sale.id;

  if v_sale.status = 'cancelled' and v_sale_cancel_event_count = 0 then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'SALE_CANCEL_SYNC_EVENT_MISSING', 'message', 'Falta evento sync de cancelacion de venta.'));
  end if;

  if v_sale.status = 'cancelled' and v_sale_cancellation_event_count = 0 then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'SALE_CANCELLATION_SYNC_EVENT_MISSING', 'message', 'Falta evento sync de sale_cancellation.'));
  end if;

  if v_sale.status = 'cancelled' and v_report_event_count = 0 then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'REPORT_SYNC_EVENT_MISSING', 'message', 'Falta evento sync para refrescar reportes.'));
  end if;

  return jsonb_build_object(
    'success', true,
    'is_valid', jsonb_array_length(v_issues) = 0,
    'code', case when jsonb_array_length(v_issues) = 0 then 'OK' else 'SALE_INTEGRITY_ISSUES_FOUND' end,
    'sale', private.pos_sale_to_jsonb(v_sale),
    'folio', v_sale_folio,
    'issues', v_issues,
    'summary', jsonb_build_object(
      'cash', jsonb_build_object('original_count', v_original_cash_count, 'original_amount', v_original_cash_amount, 'reversal_count', v_reversal_cash_count, 'reversal_amount', v_reversal_cash_amount),
      'inventory', jsonb_build_object('sale_out_count', v_sale_out_count, 'sale_out_qty', v_sale_out_qty, 'return_in_count', v_return_in_count, 'return_in_qty', v_return_in_qty),
      'credit', jsonb_build_object('charge_id', v_charge.id, 'payment_id', v_payment.id, 'cancel_charge_count', v_cancel_charge_count, 'cancel_payment_count', v_cancel_payment_count, 'customer_debt', v_customer_debt, 'ledger_debt', v_ledger_debt, 'subsequent_payment_count', v_subsequent_payment_count),
      'sync', jsonb_build_object('sale_cancel_events', v_sale_cancel_event_count, 'sale_cancellation_events', v_sale_cancellation_event_count, 'report_events', v_report_event_count)
    ),
    'mode', 'cloud_sale_integrity_validation'
  );
end;
$function$;

revoke execute on function public.pos_cancel_cloud_sale_apply_fase6e(text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.pos_cancel_cloud_sale(text,text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.pos_preview_cloud_sale_cancellation(text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.pos_validate_cloud_sale_integrity(text,text,text,text,text) to anon, authenticated;
;
