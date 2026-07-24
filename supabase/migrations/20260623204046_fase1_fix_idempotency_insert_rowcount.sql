create or replace function private.insert_pos_idempotency_processing(
  p_license_id uuid,
  p_idempotency_key text,
  p_operation_type text,
  p_entity_type text,
  p_entity_id text,
  p_request_hash text default null
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_row_count integer := 0;
begin
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.pos_idempotency_keys (
    license_id,
    idempotency_key,
    operation_type,
    entity_type,
    entity_id,
    request_hash,
    status,
    expires_at
  ) values (
    p_license_id,
    p_idempotency_key,
    p_operation_type,
    p_entity_type,
    p_entity_id,
    p_request_hash,
    'processing',
    now() + interval '7 days'
  )
  on conflict (license_id, idempotency_key) do nothing;

  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$$;;
