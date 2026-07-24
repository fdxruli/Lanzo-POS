-- ECOM.ORDERS.2.1 — Tracking resolver independent from storefront publication and stable portal rate limit.

create or replace function private.ecommerce_get_tracking_portal_by_slug_v1(p_slug text)
returns public.ecommerce_portals
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_slug text;
  v_portal public.ecommerce_portals%rowtype;
begin
  v_slug := private.ecommerce_normalize_slug(p_slug);
  if v_slug is null then return null; end if;

  select p.* into v_portal
  from public.ecommerce_portals p
  join public.licenses l on l.id = p.license_id
  where p.slug = v_slug
    and p.deleted_at is null
    and lower(coalesce(l.status::text, 'active')) not in ('revoked','deleted','disabled','blocked')
  limit 1;

  if v_portal.id is null then return null; end if;
  return v_portal;
end;
$function$;

create or replace function public.ecommerce_get_order_tracking(p_slug text,p_tracking_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_slug text;v_token text;v_token_hash bytea;v_portal public.ecommerce_portals%rowtype;
  v_portal_limit jsonb;v_token_limit jsonb;v_order public.ecommerce_orders%rowtype;
  v_tracking private.ecommerce_order_tracking_tokens%rowtype;v_items jsonb;
  v_realtime_enabled boolean:=false;v_storefront_available boolean:=false;v_public_status text;
begin
  v_slug:=lower(left(btrim(coalesce(p_slug,'')),160));
  v_token:=left(btrim(coalesce(p_tracking_token,'')),128);
  if v_slug='' then return private.ecommerce_tracking_not_found_v1();end if;

  v_portal:=private.ecommerce_get_tracking_portal_by_slug_v1(v_slug);
  if v_portal.id is null then return private.ecommerce_tracking_not_found_v1();end if;

  v_portal_limit:=public.enforce_pos_rpc_rate_limit_v2(
    p_license_key:='ecommerce-tracking:'||v_portal.license_id::text,
    p_device_fingerprint:='tracking-portal:'||v_portal.id::text,
    p_staff_session_token:=null,
    p_rpc_name:='ecommerce_get_order_tracking',
    p_scope:='ECOMMERCE_ORDER_TRACKING_PORTAL',
    p_max_attempts:=600,p_window_seconds:=600,p_block_seconds:=300,
    p_code:='ECOMMERCE_TRACKING_RATE_LIMITED',
    p_metadata:=jsonb_build_object('source','ecommerce_public_tracking','phase','ECOM.ORDERS.2.1','bucket','portal')
  );
  if coalesce((v_portal_limit->>'allowed')::boolean,false) is false then return private.ecommerce_tracking_rate_limited_v1();end if;

  if v_token!~'^trk1_[A-Za-z0-9_-]{43}$' then return private.ecommerce_tracking_not_found_v1();end if;
  v_token_hash:=extensions.digest(convert_to(v_token,'UTF8'),'sha256');

  select t.* into v_tracking from private.ecommerce_order_tracking_tokens t
  where t.token_hash=v_token_hash and t.portal_id=v_portal.id and t.license_id=v_portal.license_id
    and t.revoked_at is null and (t.expires_at is null or t.expires_at>now()) limit 1;
  if v_tracking.order_id is null then return private.ecommerce_tracking_not_found_v1();end if;

  v_token_limit:=public.enforce_pos_rpc_rate_limit_v2(
    p_license_key:='ecommerce-tracking:'||v_portal.license_id::text,
    p_device_fingerprint:='tracking-token:'||left(encode(v_token_hash,'hex'),32),
    p_staff_session_token:=null,
    p_rpc_name:='ecommerce_get_order_tracking',
    p_scope:='ECOMMERCE_ORDER_TRACKING_TOKEN',
    p_max_attempts:=120,p_window_seconds:=600,p_block_seconds:=300,
    p_code:='ECOMMERCE_TRACKING_RATE_LIMITED',
    p_metadata:=jsonb_build_object('source','ecommerce_public_tracking','phase','ECOM.ORDERS.2.1','bucket','valid_token')
  );
  if coalesce((v_token_limit->>'allowed')::boolean,false) is false then return private.ecommerce_tracking_rate_limited_v1();end if;

  select o.* into v_order from public.ecommerce_orders o
  where o.id=v_tracking.order_id and o.portal_id=v_tracking.portal_id and o.license_id=v_tracking.license_id limit 1;
  if v_order.id is null then return private.ecommerce_tracking_not_found_v1();end if;

  select coalesce(jsonb_agg(jsonb_build_object('name',i.product_name,'quantity',i.quantity) order by i.created_at,i.id),'[]'::jsonb)
  into v_items from public.ecommerce_order_items i
  where i.order_id=v_order.id and i.portal_id=v_order.portal_id and i.license_id=v_order.license_id;

  v_public_status:=private.ecommerce_order_public_status_v1(v_order.status,v_order.fulfillment_status);
  v_realtime_enabled:=private.ecommerce_license_feature_bool(v_order.license_id,'ecommerce_realtime_orders',false);
  v_storefront_available:=v_portal.status='published'
    and private.ecommerce_license_feature_bool(v_order.license_id,'ecommerce_portal_enabled',false);

  return jsonb_build_object('success',true,'tracking',jsonb_strip_nulls(jsonb_build_object(
    'orderCode',v_order.public_order_code,'status',v_public_status,'fulfillmentMethod',v_order.fulfillment_method,
    'createdAt',v_order.created_at,'updatedAt',coalesce(v_order.fulfillment_updated_at,v_order.updated_at),
    'total',v_order.total,'currency',v_order.currency,'items',coalesce(v_items,'[]'::jsonb),
    'publicMessage',v_order.public_status_message,'version',greatest(v_order.fulfillment_version,0),
    'paymentRegistered',(v_order.payment_status='paid' or v_order.converted_sale_id is not null or v_order.pos_conversion_status='completed'),
    'storefrontAvailable',v_storefront_available,
    'realtime',jsonb_build_object('enabled',v_realtime_enabled,'topic',case when v_realtime_enabled then private.ecommerce_tracking_topic_v1(v_tracking.token_hash) else null end)
  )));
exception when others then return private.ecommerce_tracking_not_found_v1();end;
$function$;

delete from public.pos_rpc_rate_limits
where scope = 'ECOMMERCE_ORDER_TRACKING';

revoke all on function private.ecommerce_get_tracking_portal_by_slug_v1(text) from public,anon,authenticated;
revoke all on function public.ecommerce_get_order_tracking(text,text) from public;
grant execute on function public.ecommerce_get_order_tracking(text,text) to anon,authenticated,service_role;

alter function private.ecommerce_get_tracking_portal_by_slug_v1(text) owner to postgres;
alter function public.ecommerce_get_order_tracking(text,text) owner to postgres;

comment on function private.ecommerce_get_tracking_portal_by_slug_v1(text)
is 'ECOM.ORDERS.2.1: resolves non-deleted portals for existing-order tracking independently from storefront publication.';
;
