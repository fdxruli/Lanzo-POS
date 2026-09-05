-- CLOUD LAYAWAYS FINANCIAL REQUEST CANONICALIZATION R1
--
-- The read-RPC hardening intentionally redacts free-form item attributes and
-- unit cost from canonical_layaway_item_v1.  Financial request hashing needs a
-- separate projection because the browser contract includes those fields.
-- This migration is forward-only and does not change the public response
-- projections or the financial validation boundary.

begin;

-- JS compact() removes null values from the object being built, but it does
-- not recursively remove nulls inside an attributes object.  jsonb_strip_nulls
-- is recursive, so use a shallow object compactor for the financial contract.
create or replace function private.financial_compact_object_v1(p_object jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select case
    when $1 is null or $1 = 'null'::jsonb then $1
    when jsonb_typeof($1) <> 'object' then $1
    else coalesce(
      (
        select jsonb_object_agg(entry.key, entry.value order by entry.key collate "C")
          from jsonb_each($1) as entry(key, value)
         where entry.value <> 'null'::jsonb
      ),
      '{}'::jsonb
    )
  end
$function$;

-- Financial canonicalization mirrors layawayItem() in
-- src/services/financial/financialCanonicalV1.js.  In particular, attributes
-- and variant_attributes are retained in the hash document, while their
-- immediate null values are compacted only at the item level and nested nulls
-- remain part of the JSON contract.
create or replace function private.canonical_layaway_financial_item_v1(p_item jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if jsonb_typeof(p_item) <> 'object' then
    raise exception 'LAYAWAY_ITEM_INVALID' using errcode = 'P0001';
  end if;

  return private.financial_compact_object_v1(jsonb_build_object(
    'id', private.layaway_request_text_v1(p_item, array['id']),
    'product_id', private.layaway_request_text_v1(p_item, array['product_id','productId','parentId']),
    'product_name', private.layaway_request_text_v1(p_item, array['product_name','productName','name']),
    'product_sku', private.layaway_request_text_v1(p_item, array['product_sku','productSku','sku']),
    'barcode', private.layaway_request_text_v1(p_item, array['barcode','barCode']),
    'category_id', private.layaway_request_text_v1(p_item, array['category_id','categoryId']),
    'category_name', private.layaway_request_text_v1(p_item, array['category_name','categoryName','rubro','category']),
    'rubro', private.layaway_request_text_v1(p_item, array['rubro','category','categoryName']),
    'batch_id', private.layaway_request_text_v1(p_item, array['batch_id','batchId']),
    'batch_sku', private.layaway_request_text_v1(p_item, array['batch_sku','batchSku']),
    'batch_expiry_date', private.layaway_request_text_v1(p_item, array['batch_expiry_date','batchExpiryDate','expiryDate']),
    'variant_id', private.layaway_request_text_v1(p_item, array['variant_id','variantId']),
    'size', private.layaway_request_text_v1(p_item, array['size','talla']),
    'color', private.layaway_request_text_v1(p_item, array['color','colorName']),
    'attributes', case when jsonb_typeof(p_item->'attributes') = 'object' then p_item->'attributes' else null end,
    'variant_attributes', case
      when jsonb_typeof(p_item->'variant_attributes') = 'object' then p_item->'variant_attributes'
      when jsonb_typeof(p_item->'variantAttributes') = 'object' then p_item->'variantAttributes'
      else null
    end,
    'quantity', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(p_item, array['quantity','qty'])),
    'unit_price', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(p_item, array['unit_price','unitPrice','price'])),
    'unit_cost', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(p_item, array['unit_cost','unitCost','cost'])),
    'line_total', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(p_item, array['line_total','lineTotal','total','exactTotal'])),
    'discount_amount', coalesce(private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(p_item, array['discount_amount','discountAmount'])), '0'),
    'tax_amount', coalesce(private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(p_item, array['tax_amount','taxAmount'])), '0')
  ));
end;
$function$;

-- Rebuild only the private financial request projection.  The read helper
-- remains redacted and is intentionally not replaced here.
create or replace function private.canonical_layaway_request_v1(
  p_operation_type text,
  p_request jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_layaway jsonb;
  v_payment jsonb;
  v_items jsonb;
begin
  if jsonb_typeof(coalesce(p_request, '{}'::jsonb)) <> 'object' then
    raise exception 'FINANCIAL_REQUEST_CONTRACT_INVALID' using errcode = 'P0001';
  end if;

  case p_operation_type
    when 'layaway.create' then
      v_layaway := private.layaway_record_v1(p_request);
      if jsonb_typeof(v_layaway) <> 'object' then
        raise exception 'LAYAWAY_PAYLOAD_INVALID' using errcode = 'P0001';
      end if;
      v_items := case when jsonb_typeof(v_layaway->'items') = 'array' then v_layaway->'items' else '[]'::jsonb end;
      if jsonb_typeof(v_items) <> 'array' then
        raise exception 'LAYAWAY_ITEMS_INVALID' using errcode = 'P0001';
      end if;
      v_payment := private.layaway_payment_payload_v1(p_request);
      return private.financial_compact_object_v1(jsonb_build_object(
        'layaway', private.financial_compact_object_v1(jsonb_build_object(
          'id', private.layaway_request_text_v1(v_layaway, array['id','layaway_id','layawayId']),
          'customer_id', private.layaway_request_text_v1(v_layaway, array['customer_id','customerId']),
          'customer_name', private.layaway_request_text_v1(v_layaway, array['customer_name','customerName']),
          'customer_phone', private.layaway_request_text_v1(v_layaway, array['customer_phone','customerPhone']),
          'total_amount', private.financial_decimal_v1(private.financial_first_nonblank_scalar_v1(v_layaway, array['total_amount','totalAmount','total'])),
          'currency', upper(coalesce(private.layaway_request_text_v1(v_layaway, array['currency']), 'MXN')),
          'deadline', private.layaway_deadline_v1(private.financial_first_nonblank_scalar_v1(v_layaway, array['deadline','due_date','dueDate'])),
          'items', (select coalesce(jsonb_agg(private.canonical_layaway_financial_item_v1(value) order by ordinality), '[]'::jsonb)
                    from jsonb_array_elements(v_items) with ordinality)
        )),
        'initial_payment', case when jsonb_typeof(v_payment) = 'object' and v_payment <> '{}'::jsonb
          then private.canonical_layaway_payment_v1(
            v_payment || jsonb_build_object('cash_session_id', private.layaway_request_cash_session_id_v1(p_request))
          ) else null end,
        'cash_session_id', private.layaway_request_cash_session_id_v1(p_request)
      ));
    when 'layaway.payment' then
      return private.financial_compact_object_v1(jsonb_build_object(
        'layaway_id', private.layaway_request_id_v1(p_request),
        'payment', private.canonical_layaway_payment_v1(
          private.layaway_payment_payload_v1(p_request)
          || jsonb_build_object('cash_session_id', private.layaway_request_cash_session_id_v1(p_request))
        ),
        'cash_session_id', private.layaway_request_cash_session_id_v1(p_request)
      ));
    when 'layaway.cancel' then
      return private.financial_compact_object_v1(jsonb_build_object(
        'layaway_id', private.layaway_request_id_v1(p_request),
        'reason', private.layaway_request_text_v1(p_request, array['reason','motivo'], 'Cancelación de apartado'),
        'retain_money', private.layaway_request_bool_v1(p_request, array['retain_money','retainMoney','retained_money']),
        'refund_id', private.layaway_request_text_v1(p_request, array['refund_id','refundId']),
        'cash_session_id', private.layaway_request_cash_session_id_v1(p_request)
      ));
    else
      raise exception 'FINANCIAL_OPERATION_TYPE_UNSUPPORTED' using errcode = 'P0001';
  end case;
end;
$function$;

revoke all on function private.financial_compact_object_v1(jsonb) from public, anon, authenticated;
revoke all on function private.canonical_layaway_financial_item_v1(jsonb) from public, anon, authenticated;
revoke all on function private.canonical_layaway_request_v1(text, jsonb) from public, anon, authenticated;

commit;
