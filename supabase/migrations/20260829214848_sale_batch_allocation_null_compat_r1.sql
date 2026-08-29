-- SALE.BATCH.ALLOCATION.NULL.COMPAT.R1
-- Forward-only compatibility patch for the R2B batch-allocation boundary.
-- JSONB null is a JSON value, not SQL NULL; normalize only that value while
-- retaining the existing fail-closed array/type and allocation checks.
begin;

do $$
declare
  v_signature text := 'private.r2b_authorize_sale_financial_request_v1(text,text,text,text,text,jsonb,jsonb,jsonb,text,text,text)';
  v_definition text;
  v_old text := $old$
    v_raw_batches := coalesce(
      v_item_payload->'batches_used', v_item_payload->'batchesUsed',
      v_item_payload->'metadata'->'batches_used', v_item_payload->'metadata'->'batchesUsed',
      '[]'::jsonb
    );
$old$;
  v_new text := $new$
    -- SALE_BATCH_ALLOCATION_NULL_COMPAT_R1: JSONB null means no explicit allocation.
    v_raw_batches := coalesce(
      nullif(v_item_payload->'batches_used', 'null'::jsonb),
      nullif(v_item_payload->'batchesUsed', 'null'::jsonb),
      nullif(v_item_payload->'metadata'->'batches_used', 'null'::jsonb),
      nullif(v_item_payload->'metadata'->'batchesUsed', 'null'::jsonb),
      '[]'::jsonb
    );
$new$;
begin
  v_definition := pg_get_functiondef(v_signature::regprocedure);

  if position('SALE_BATCH_ALLOCATION_NULL_COMPAT_R1' in v_definition) = 0 then
    if position(v_old in v_definition) = 0 then
      raise exception 'SALE_BATCH_ALLOCATION_NULL_COMPAT_FUNCTION_SHAPE_UNEXPECTED'
        using errcode = 'P0001';
    end if;
    if length(v_definition) - length(replace(v_definition, v_old, '')) <> length(v_old) then
      raise exception 'SALE_BATCH_ALLOCATION_NULL_COMPAT_MULTIPLE_TARGETS'
        using errcode = 'P0001';
    end if;
    v_definition := replace(v_definition, v_old, v_new);
    execute v_definition;
  end if;

  v_definition := pg_get_functiondef(v_signature::regprocedure);
  if position('SALE_BATCH_ALLOCATION_NULL_COMPAT_R1' in v_definition) = 0
     or position('nullif(v_item_payload->''batches_used'', ''null''::jsonb)' in v_definition) = 0
     or position('nullif(v_item_payload->''batchesUsed'', ''null''::jsonb)' in v_definition) = 0
     or position('nullif(v_item_payload->''metadata''->''batches_used'', ''null''::jsonb)' in v_definition) = 0
     or position('nullif(v_item_payload->''metadata''->''batchesUsed'', ''null''::jsonb)' in v_definition) = 0
     or position('jsonb_typeof(v_raw_batches) <> ''array''' in v_definition) = 0
     or position('BATCH_ALLOCATION_INVALID' in v_definition) = 0
     or position('CLOUD_BATCH_ALLOCATION_MISMATCH' in v_definition) = 0 then
    raise exception 'SALE_BATCH_ALLOCATION_NULL_COMPAT_CONTRACT_MISSING'
      using errcode = 'P0001';
  end if;
end;
$$;

-- CREATE OR REPLACE preserves the existing private function owner and ACL.
-- No public wrapper, actor check, price/cost/discount authority, inventory
-- effect engine, idempotency path, or cash/session behavior is replaced here.
revoke all on function private.r2b_authorize_sale_financial_request_v1(text,text,text,text,text,jsonb,jsonb,jsonb,text,text,text)
  from public, anon, authenticated;

commit;
