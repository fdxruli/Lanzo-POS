-- Allow kitchen item status RPCs to publish their sync events.
-- The remote function public.pos_update_restaurant_order_item_status records:
--   - restaurant_order_item / status_update
--   - restaurant_order / status_recalculate
-- Without these values the RPC returns HTTP 400 after the item update attempt.

alter table public.pos_sync_events
  drop constraint if exists pos_sync_events_operation_check;

alter table public.pos_sync_events
  add constraint pos_sync_events_operation_check
  check (
    operation = any (array[
      'create'::text,
      'update'::text,
      'delete'::text,
      'restore'::text,
      'upsert'::text,
      'upsert_shadow'::text,
      'cloud_commit'::text,
      'cancel'::text,
      'toggle_status'::text,
      'status_update'::text,
      'status_recalculate'::text,
      'sync_checkpoint'::text,
      'open'::text,
      'close'::text,
      'movement'::text,
      'adjust'::text,
      'unknown'::text
    ])
  );

comment on constraint pos_sync_events_operation_check on public.pos_sync_events
is 'Allows POS sync event operation names, including restaurant kitchen item status events emitted by pos_update_restaurant_order_item_status.';
