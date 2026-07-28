-- ECOM.BUSINESS.CAPABILITIES.WHOLESALE.1
-- Compensating migration. Public pricing applies signed variant delta and option
-- adjustments after the standard or wholesale base; only the final unit price is
-- constrained to be non-negative by checkout. Do not edit prior applied phase
-- migrations: this changes the canonical writer and its table constraints.

alter table public.ecommerce_published_product_variants
  drop constraint if exists ecommerce_variant_price_nonnegative;

alter table public.ecommerce_published_product_variants
  add constraint ecommerce_variant_price_mode_value_check
  check (price_mode = 'delta' or price_value >= 0);

alter table public.ecommerce_published_options
  drop constraint if exists ecommerce_option_price_nonnegative;

do $migration$
declare
  v_definition text;
  v_replaced text;
begin
  select pg_get_functiondef(
    'private.ecommerce_apply_product_configuration(uuid,uuid,jsonb,text)'::regprocedure
  ) into v_definition;

  -- Delta variants can be negative; base and absolute values remain prices and
  -- therefore remain non-negative. This is the writer used by v2/v3 RPCs.
  v_replaced := replace(
    v_definition,
    'or coalesce(nullif(v_variant->>''priceValue'','''')::numeric,0) < 0',
    'or (coalesce(nullif(v_variant->>''priceMode'',''''),''base'') <> ''delta'' and coalesce(nullif(v_variant->>''priceValue'','''')::numeric,0) < 0)'
  );
  if v_replaced = v_definition then
    raise exception 'ECOMMERCE_SIGNED_VARIANT_WRITER_PATCH_NOT_APPLIED';
  end if;
  v_definition := v_replaced;

  -- Public option price deltas are adjustments, not standalone prices. A
  -- negative adjustment is valid as long as public checkout clamps the final
  -- computed unit price at zero.
  v_replaced := replace(
    v_definition,
    'or coalesce(nullif(v_option->>''priceDelta'','''')::numeric,0) < 0 then',
    'then'
  );
  if v_replaced = v_definition then
    raise exception 'ECOMMERCE_SIGNED_OPTION_WRITER_PATCH_NOT_APPLIED';
  end if;

  execute v_replaced;
end;
$migration$;

alter function private.ecommerce_apply_product_configuration(uuid,uuid,jsonb,text)
  owner to postgres;
revoke all on function private.ecommerce_apply_product_configuration(uuid,uuid,jsonb,text)
  from public, anon, authenticated, service_role;

comment on constraint ecommerce_variant_price_mode_value_check
  on public.ecommerce_published_product_variants is
  'Delta variants are signed adjustments. Base and absolute variant values are non-negative prices.';
