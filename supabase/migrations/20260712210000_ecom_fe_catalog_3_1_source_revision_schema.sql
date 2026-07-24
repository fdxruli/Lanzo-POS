-- ECOM.FE.CATALOG.3.1 - Esquema de revisiones y contrato publico seguro.
-- No aplicar a produccion durante la revision del PR.

alter table public.ecommerce_published_products
  add column if not exists source_revision_kind text,
  add column if not exists source_revision_order numeric,
  add column if not exists source_payload_hash text;

DO $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ecommerce_published_products_source_revision_kind_valid'
  ) then
    alter table public.ecommerce_published_products
      add constraint ecommerce_published_products_source_revision_kind_valid
      check (source_revision_kind is null or source_revision_kind in ('version', 'timestamp', 'opaque'));
  end if;
end;
$$;

create or replace function private.ecommerce_parse_source_revision(p_revision text)
returns jsonb
language plpgsql
immutable
security definer
set search_path to ''
as $$
declare
  v_revision text;
  v_value text;
begin
  v_revision := left(nullif(btrim(coalesce(p_revision, '')), ''), 160);
  if v_revision is null then
    return jsonb_build_object(
      'normalized', null,
      'kind', null,
      'order', null,
      'comparable', false
    );
  end if;

  if v_revision ~ '^version:[0-9]+([.][0-9]+)?$' then
    v_value := substring(v_revision from length('version:') + 1);
    return jsonb_build_object(
      'normalized', v_revision,
      'kind', 'version',
      'order', v_value::numeric,
      'comparable', true
    );
  end if;

  if v_revision ~ '^timestamp:[0-9]+$' then
    v_value := substring(v_revision from length('timestamp:') + 1);
    return jsonb_build_object(
      'normalized', v_revision,
      'kind', 'timestamp',
      'order', v_value::numeric,
      'comparable', true
    );
  end if;

  if v_revision like 'opaque:%' then
    return jsonb_build_object(
      'normalized', v_revision,
      'kind', 'opaque',
      'order', null,
      'comparable', false
    );
  end if;

  return jsonb_build_object(
    'normalized', 'opaque:' || left(v_revision, 153),
    'kind', 'opaque',
    'order', null,
    'comparable', false
  );
exception
  when others then
    return jsonb_build_object(
      'normalized', null,
      'kind', null,
      'order', null,
      'comparable', false
    );
end;
$$;

create or replace function private.ecommerce_projection_payload_hash(p_projection jsonb)
returns text
language sql
immutable
security definer
set search_path to ''
as $$
  select encode(extensions.digest(coalesce(p_projection, '{}'::jsonb)::text, 'sha256'), 'hex');
$$;

create or replace function private.ecommerce_source_revision_decision(
  p_existing_kind text,
  p_existing_order numeric,
  p_existing_revision text,
  p_existing_hash text,
  p_incoming_kind text,
  p_incoming_order numeric,
  p_incoming_revision text,
  p_incoming_hash text
)
returns text
language plpgsql
immutable
security definer
set search_path to ''
as $$
begin
  if p_existing_hash is null then
    if p_existing_revision is null then return 'apply'; end if;
    return 'conflict';
  end if;

  if p_existing_kind in ('version', 'timestamp')
     and p_incoming_kind = p_existing_kind
     and p_existing_order is not null
     and p_incoming_order is not null then
    if p_incoming_order < p_existing_order then return 'stale'; end if;
    if p_incoming_order > p_existing_order then return 'apply'; end if;
    if p_existing_hash = p_incoming_hash then return 'idempotent'; end if;
    return 'conflict';
  end if;

  if p_existing_kind = 'opaque'
     and p_incoming_kind = 'opaque'
     and p_existing_revision = p_incoming_revision
     and p_existing_hash = p_incoming_hash then
    return 'idempotent';
  end if;

  if p_existing_kind is null
     and p_incoming_kind is null
     and p_existing_hash = p_incoming_hash then
    return 'idempotent';
  end if;

  return 'conflict';
end;
$$;

-- El contrato publico nunca inventa cero para estados no confirmados.
create or replace function private.ecommerce_product_public_signature(
  p_product public.ecommerce_published_products
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select case
    when p_product.id is null
      or p_product.deleted_at is not null
      or p_product.is_published is not true
      then null
    else jsonb_build_object(
      'id', p_product.id,
      'name', p_product.public_name,
      'description', p_product.public_description,
      'categoryName', p_product.category_name,
      'price', p_product.price,
      'currency', p_product.currency,
      'imageUrl', p_product.image_url,
      'isAvailable', p_product.is_available,
      'displayOrder', p_product.display_order,
      'stock', case
        when private.ecommerce_license_feature_bool(
          p_product.license_id,
          'ecommerce_stock_visibility',
          false
        ) is not true then jsonb_build_object(
          'mode', 'hidden', 'status', null, 'quantity', null
        )
        when p_product.source_state not in ('in_stock', 'out_of_stock')
          or p_product.stock_snapshot is null then jsonb_build_object(
          'mode', 'hidden', 'status', null, 'quantity', null
        )
        when p_product.stock_mode = 'status' then jsonb_build_object(
          'mode', 'status',
          'status', case
            when p_product.source_available is true and p_product.stock_snapshot > 0
              then 'available'
            else 'out_of_stock'
          end,
          'quantity', null
        )
        when p_product.stock_mode = 'exact' then jsonb_build_object(
          'mode', 'exact',
          'status', case
            when p_product.source_available is true and p_product.stock_snapshot > 0
              then 'available'
            else 'out_of_stock'
          end,
          'quantity', greatest(p_product.stock_snapshot, 0)
        )
        else jsonb_build_object(
          'mode', 'hidden', 'status', null, 'quantity', null
        )
      end,
      'options', p_product.options
    )
  end;
$$;

create or replace function private.ecommerce_product_public_jsonb(
  p_product public.ecommerce_published_products,
  p_allow_stock_visibility boolean
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object(
    'id', p_product.id,
    'name', p_product.public_name,
    'description', p_product.public_description,
    'categoryName', p_product.category_name,
    'price', p_product.price,
    'currency', p_product.currency,
    'imageUrl', p_product.image_url,
    'isAvailable', p_product.is_available,
    'displayOrder', p_product.display_order,
    'stock', case
      when p_allow_stock_visibility is not true then jsonb_build_object(
        'mode', 'hidden', 'status', null, 'quantity', null
      )
      when p_product.source_state not in ('in_stock', 'out_of_stock')
        or p_product.stock_snapshot is null then jsonb_build_object(
        'mode', 'hidden', 'status', null, 'quantity', null
      )
      when p_product.stock_mode = 'status' then jsonb_build_object(
        'mode', 'status',
        'status', case
          when p_product.source_available is true and p_product.stock_snapshot > 0
            then 'available'
          else 'out_of_stock'
        end,
        'quantity', null
      )
      when p_product.stock_mode = 'exact' then jsonb_build_object(
        'mode', 'exact',
        'status', case
          when p_product.source_available is true and p_product.stock_snapshot > 0
            then 'available'
          else 'out_of_stock'
        end,
        'quantity', greatest(p_product.stock_snapshot, 0)
      )
      else jsonb_build_object(
        'mode', 'hidden', 'status', null, 'quantity', null
      )
    end,
    'options', p_product.options
  );
$$;

revoke all on function private.ecommerce_parse_source_revision(text)
  from public, anon, authenticated;
revoke all on function private.ecommerce_projection_payload_hash(jsonb)
  from public, anon, authenticated;
revoke all on function private.ecommerce_source_revision_decision(
  text, numeric, text, text, text, numeric, text, text
) from public, anon, authenticated;
revoke all on function private.ecommerce_product_public_jsonb(
  public.ecommerce_published_products, boolean
) from public, anon, authenticated;

grant execute on function private.ecommerce_parse_source_revision(text) to service_role;
grant execute on function private.ecommerce_projection_payload_hash(jsonb) to service_role;
grant execute on function private.ecommerce_source_revision_decision(
  text, numeric, text, text, text, numeric, text, text
) to service_role;
grant execute on function private.ecommerce_product_public_jsonb(
  public.ecommerce_published_products, boolean
) to service_role;
;
