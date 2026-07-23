-- ECOM.ORDERS.2 / 4
-- Grants, private Realtime authorization and final hardening.

create or replace function private.can_access_ecommerce_tracking_topic_v1(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from private.ecommerce_order_tracking_tokens t
    where t.revoked_at is null
      and (t.expires_at is null or t.expires_at > now())
      and private.ecommerce_tracking_topic_v1(t.token_hash) = p_topic
      and private.ecommerce_license_feature_bool(
        t.license_id, 'ecommerce_realtime_orders', false
      ) is true
  );
$function$;

create or replace function realtime.lanzo_can_access_ecommerce_tracking_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.can_access_ecommerce_tracking_topic_v1(p_topic);
$function$;

drop policy if exists "Lanzo private ecommerce tracking broadcast receive" on realtime.messages;
create policy "Lanzo private ecommerce tracking broadcast receive"
on realtime.messages
for select
to anon, authenticated
using (
  extension = 'broadcast'
  and realtime.lanzo_can_access_ecommerce_tracking_topic((select realtime.topic()))
);

create or replace function private.broadcast_ecommerce_tracking_change_v1(
  p_order_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.ecommerce_orders%rowtype;
  v_tracking private.ecommerce_order_tracking_tokens%rowtype;
  v_topic text;
  v_payload jsonb;
begin
  if p_order_id is null then
    return jsonb_build_object('success', false, 'broadcasted', false);
  end if;

  select o.* into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id
  limit 1;

  if v_order.id is null then
    return jsonb_build_object('success', false, 'broadcasted', false);
  end if;

  if private.ecommerce_license_feature_bool(
    v_order.license_id, 'ecommerce_realtime_orders', false
  ) is not true then
    return jsonb_build_object(
      'success', true, 'broadcasted', false, 'code', 'REALTIME_DISABLED'
    );
  end if;

  select t.* into v_tracking
  from private.ecommerce_order_tracking_tokens t
  where t.order_id = v_order.id
    and t.portal_id = v_order.portal_id
    and t.license_id = v_order.license_id
    and t.revoked_at is null
    and (t.expires_at is null or t.expires_at > now())
  limit 1;

  if v_tracking.order_id is null then
    return jsonb_build_object(
      'success', true, 'broadcasted', false, 'code', 'TRACKING_NOT_ISSUED'
    );
  end if;

  v_topic := private.ecommerce_tracking_topic_v1(v_tracking.token_hash);
  v_payload := jsonb_build_object(
    'event', 'tracking_changed',
    'reason', case
      when p_reason in ('order_status_changed','fulfillment_changed','payment_changed')
        then p_reason
      else 'order_changed'
    end,
    'version', greatest(v_order.fulfillment_version, 0),
    'created_at', now()
  );

  perform realtime.send(v_payload, 'tracking_changed', v_topic, true);
  return jsonb_build_object('success', true, 'broadcasted', true);
exception when others then
  return jsonb_build_object(
    'success', false,
    'broadcasted', false,
    'code', 'ECOMMERCE_TRACKING_BROADCAST_FAILED'
  );
end;
$function$;

create or replace function private.ecommerce_broadcast_tracking_change_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_reason text := 'order_changed';
begin
  if new.fulfillment_status is distinct from old.fulfillment_status
     or new.fulfillment_version is distinct from old.fulfillment_version
     or new.public_status_message is distinct from old.public_status_message then
    v_reason := 'fulfillment_changed';
  elsif new.payment_status is distinct from old.payment_status
     or new.converted_sale_id is distinct from old.converted_sale_id
     or new.pos_conversion_status is distinct from old.pos_conversion_status then
    v_reason := 'payment_changed';
  elsif new.status is distinct from old.status then
    v_reason := 'order_status_changed';
  else
    return new;
  end if;

  perform private.broadcast_ecommerce_tracking_change_v1(new.id, v_reason);
  return new;
end;
$function$;

drop trigger if exists ecommerce_orders_broadcast_public_tracking on public.ecommerce_orders;
create trigger ecommerce_orders_broadcast_public_tracking
after update of
  status,
  fulfillment_status,
  fulfillment_version,
  public_status_message,
  payment_status,
  converted_sale_id,
  pos_conversion_status
on public.ecommerce_orders
for each row execute function private.ecommerce_broadcast_tracking_change_trigger_v1();

revoke all on function private.can_access_ecommerce_tracking_topic_v1(text) from public, anon, authenticated;
revoke all on function private.broadcast_ecommerce_tracking_change_v1(uuid, text) from public, anon, authenticated;
revoke all on function private.ecommerce_broadcast_tracking_change_trigger_v1() from public, anon, authenticated;

revoke all on function realtime.lanzo_can_access_ecommerce_tracking_topic(text) from public;
grant execute on function realtime.lanzo_can_access_ecommerce_tracking_topic(text) to anon, authenticated;

revoke all on function public.ecommerce_get_order_tracking(text, text) from public;
grant execute on function public.ecommerce_get_order_tracking(text, text) to anon, authenticated;

revoke all on function public.ecommerce_admin_update_order_fulfillment(
  text, text, text, text, uuid, text, bigint, text, text
) from public;
grant execute on function public.ecommerce_admin_update_order_fulfillment(
  text, text, text, text, uuid, text, bigint, text, text
) to anon, authenticated;

revoke all on table private.ecommerce_order_tracking_keys from public, anon, authenticated;
revoke all on table private.ecommerce_order_tracking_tokens from public, anon, authenticated;
revoke all on table private.ecommerce_order_fulfillment_events from public, anon, authenticated;

alter function private.can_access_ecommerce_tracking_topic_v1(text) owner to postgres;
alter function realtime.lanzo_can_access_ecommerce_tracking_topic(text) owner to postgres;
alter function private.broadcast_ecommerce_tracking_change_v1(uuid, text) owner to postgres;
alter function private.ecommerce_broadcast_tracking_change_trigger_v1() owner to postgres;
alter function public.ecommerce_get_order_tracking(text, text) owner to postgres;
alter function public.ecommerce_admin_update_order_fulfillment(
  text, text, text, text, uuid, text, bigint, text, text
) owner to postgres;

comment on policy "Lanzo private ecommerce tracking broadcast receive"
  on realtime.messages is
  'Possession-based private broadcast authorization using a non-reversible tracking token hash topic. Payload is only a revalidation signal.';;
