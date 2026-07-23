-- ECOM.ORDERS.2.1 — Terminal fulfillment guards for POS entry/continuation paths.

create or replace function private.ecommerce_pos_terminal_guard_v1(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_order_id uuid,
  p_rpc_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth jsonb;
  v_order public.ecommerce_orders%rowtype;
begin
  v_auth := private.ecommerce_pos_draft_authorize_v1(
    p_license_key, p_device_fingerprint, p_security_token,
    p_staff_session_token, p_rpc_name
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;

  select o.* into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id
    and o.license_id = nullif(v_auth->>'license_id','')::uuid
  for update;

  if v_order.id is null then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND'); end if;

  return jsonb_build_object(
    'success', true,
    'terminal', private.ecommerce_order_fulfillment_terminal_v1(v_order.fulfillment_status),
    'fulfillmentStatus', v_order.fulfillment_status,
    'orderStatus', v_order.status,
    'convertedSaleId', v_order.converted_sale_id,
    'conversionStatus', v_order.pos_conversion_status,
    'conversionKey', v_order.pos_conversion_key
  );
end;
$function$;

alter function public.ecommerce_admin_claim_pos_draft(text,text,text,text,uuid,text)
rename to ecommerce_admin_claim_pos_draft_impl_20260713;
alter function public.ecommerce_admin_claim_pos_draft_impl_20260713(text,text,text,text,uuid,text)
set schema private;

create function public.ecommerce_admin_claim_pos_draft(
  p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text,
  p_order_id uuid,p_request_key text
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_guard jsonb;
begin
  v_guard:=private.ecommerce_pos_terminal_guard_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_order_id,'ecommerce_admin_claim_pos_draft');
  if coalesce((v_guard->>'success')::boolean,false) is false then return v_guard;end if;
  if coalesce((v_guard->>'terminal')::boolean,false) then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_FULFILLMENT_TERMINAL');end if;
  return private.ecommerce_admin_claim_pos_draft_impl_20260713(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_order_id,p_request_key);
end;$function$;

alter function public.ecommerce_admin_confirm_pos_draft(text,text,text,text,uuid,uuid,text)
rename to ecommerce_admin_confirm_pos_draft_impl_20260713;
alter function public.ecommerce_admin_confirm_pos_draft_impl_20260713(text,text,text,text,uuid,uuid,text)
set schema private;

create function public.ecommerce_admin_confirm_pos_draft(
  p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text,
  p_order_id uuid,p_claim_token uuid,p_draft_id text
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_guard jsonb;
begin
  v_guard:=private.ecommerce_pos_terminal_guard_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_order_id,'ecommerce_admin_confirm_pos_draft');
  if coalesce((v_guard->>'success')::boolean,false) is false then return v_guard;end if;
  if coalesce((v_guard->>'terminal')::boolean,false) then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_FULFILLMENT_TERMINAL');end if;
  return private.ecommerce_admin_confirm_pos_draft_impl_20260713(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_order_id,p_claim_token,p_draft_id);
end;$function$;

alter function public.ecommerce_begin_pos_conversion(text,text,text,text,uuid,uuid,text,text,text,text)
rename to ecommerce_begin_pos_conversion_impl_20260713;
alter function public.ecommerce_begin_pos_conversion_impl_20260713(text,text,text,text,uuid,uuid,text,text,text,text)
set schema private;

create function public.ecommerce_begin_pos_conversion(
 p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text,
 p_order_id uuid,p_claim_token uuid,p_draft_id text,p_attempt_id text,p_sale_id text,p_conversion_key text
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_guard jsonb;
begin
 v_guard:=private.ecommerce_pos_terminal_guard_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_order_id,'ecommerce_begin_pos_conversion');
 if coalesce((v_guard->>'success')::boolean,false) is false then return v_guard;end if;
 if coalesce((v_guard->>'terminal')::boolean,false) and not(
   v_guard->>'orderStatus'='converted_to_sale'
   and v_guard->>'convertedSaleId'=left(btrim(coalesce(p_sale_id,'')),200)
   and v_guard->>'conversionKey'=left(btrim(coalesce(p_conversion_key,'')),240)
 ) then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_FULFILLMENT_TERMINAL');end if;
 return private.ecommerce_begin_pos_conversion_impl_20260713(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_order_id,p_claim_token,p_draft_id,p_attempt_id,p_sale_id,p_conversion_key);
end;$function$;

alter function public.ecommerce_complete_pos_conversion(text,text,text,text,uuid,uuid,text,text,text,text)
rename to ecommerce_complete_pos_conversion_impl_20260713;
alter function public.ecommerce_complete_pos_conversion_impl_20260713(text,text,text,text,uuid,uuid,text,text,text,text)
set schema private;

create function public.ecommerce_complete_pos_conversion(
 p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text,
 p_order_id uuid,p_claim_token uuid,p_draft_id text,p_attempt_id text,p_sale_id text,p_conversion_key text
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_guard jsonb;
begin
 v_guard:=private.ecommerce_pos_terminal_guard_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_order_id,'ecommerce_complete_pos_conversion');
 if coalesce((v_guard->>'success')::boolean,false) is false then return v_guard;end if;
 if coalesce((v_guard->>'terminal')::boolean,false) and not(
   v_guard->>'orderStatus'='converted_to_sale'
   and v_guard->>'convertedSaleId'=left(btrim(coalesce(p_sale_id,'')),200)
   and v_guard->>'conversionKey'=left(btrim(coalesce(p_conversion_key,'')),240)
 ) then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_FULFILLMENT_TERMINAL');end if;
 return private.ecommerce_complete_pos_conversion_impl_20260713(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_order_id,p_claim_token,p_draft_id,p_attempt_id,p_sale_id,p_conversion_key);
end;$function$;

alter function public.ecommerce_get_pos_conversion_state(text,text,text,text,uuid,uuid)
rename to ecommerce_get_pos_conversion_state_impl_20260713;
alter function public.ecommerce_get_pos_conversion_state_impl_20260713(text,text,text,text,uuid,uuid)
set schema private;

create function public.ecommerce_get_pos_conversion_state(
 p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text,p_order_id uuid,p_claim_token uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_result jsonb;v_fulfillment text;
begin
 v_result:=private.ecommerce_get_pos_conversion_state_impl_20260713(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_order_id,p_claim_token);
 if coalesce((v_result->>'success')::boolean,false) is false then return v_result;end if;
 select o.fulfillment_status into v_fulfillment from public.ecommerce_orders o where o.id=p_order_id limit 1;
 return v_result||jsonb_build_object('fulfillmentStatus',v_fulfillment,'fulfillmentTerminal',private.ecommerce_order_fulfillment_terminal_v1(v_fulfillment));
end;$function$;

revoke all on function private.ecommerce_pos_terminal_guard_v1(text,text,text,text,uuid,text) from public,anon,authenticated;
revoke all on function private.ecommerce_admin_claim_pos_draft_impl_20260713(text,text,text,text,uuid,text) from public,anon,authenticated;
revoke all on function private.ecommerce_admin_confirm_pos_draft_impl_20260713(text,text,text,text,uuid,uuid,text) from public,anon,authenticated;
revoke all on function private.ecommerce_begin_pos_conversion_impl_20260713(text,text,text,text,uuid,uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function private.ecommerce_complete_pos_conversion_impl_20260713(text,text,text,text,uuid,uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function private.ecommerce_get_pos_conversion_state_impl_20260713(text,text,text,text,uuid,uuid) from public,anon,authenticated;

revoke all on function public.ecommerce_admin_claim_pos_draft(text,text,text,text,uuid,text) from public;
revoke all on function public.ecommerce_admin_confirm_pos_draft(text,text,text,text,uuid,uuid,text) from public;
revoke all on function public.ecommerce_begin_pos_conversion(text,text,text,text,uuid,uuid,text,text,text,text) from public;
revoke all on function public.ecommerce_complete_pos_conversion(text,text,text,text,uuid,uuid,text,text,text,text) from public;
revoke all on function public.ecommerce_get_pos_conversion_state(text,text,text,text,uuid,uuid) from public;
grant execute on function public.ecommerce_admin_claim_pos_draft(text,text,text,text,uuid,text) to anon,authenticated,service_role;
grant execute on function public.ecommerce_admin_confirm_pos_draft(text,text,text,text,uuid,uuid,text) to anon,authenticated,service_role;
grant execute on function public.ecommerce_begin_pos_conversion(text,text,text,text,uuid,uuid,text,text,text,text) to anon,authenticated,service_role;
grant execute on function public.ecommerce_complete_pos_conversion(text,text,text,text,uuid,uuid,text,text,text,text) to anon,authenticated,service_role;
grant execute on function public.ecommerce_get_pos_conversion_state(text,text,text,text,uuid,uuid) to anon,authenticated,service_role;

alter function private.ecommerce_pos_terminal_guard_v1(text,text,text,text,uuid,text) owner to postgres;
alter function public.ecommerce_admin_claim_pos_draft(text,text,text,text,uuid,text) owner to postgres;
alter function public.ecommerce_admin_confirm_pos_draft(text,text,text,text,uuid,uuid,text) owner to postgres;
alter function public.ecommerce_begin_pos_conversion(text,text,text,text,uuid,uuid,text,text,text,text) owner to postgres;
alter function public.ecommerce_complete_pos_conversion(text,text,text,text,uuid,uuid,text,text,text,text) owner to postgres;
alter function public.ecommerce_get_pos_conversion_state(text,text,text,text,uuid,uuid) owner to postgres;
;
