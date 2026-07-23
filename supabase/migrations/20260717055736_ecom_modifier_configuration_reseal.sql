-- ECOM.MODIFIER.CONFIGURATION.RESEAL
--
-- The restaurant modifier normalizer now emits the canonical selection contract
-- (selectionType, multiple, minSelect, maxSelect and inventory transport fields).
-- Existing ecommerce configuration fingerprints were produced by the previous
-- serializer. Reusing the same product server_version with the new canonical
-- payload correctly triggers ECOMMERCE_CATALOG_SOURCE_CONFLICT.
--
-- This compensatory data migration resets only the private configuration guard
-- for the affected development portal. It does not change public product data,
-- inventory, recipes, variants, option rows, orders or the portal revision.
-- The next authenticated catalog reconciliation will write the canonical hash
-- and source revision again through the normal RPC.

with affected as (
  select pp.id
  from public.ecommerce_published_products pp
  join public.ecommerce_portals portal
    on portal.id = pp.portal_id
   and portal.license_id = pp.license_id
   and portal.deleted_at is null
  join public.pos_products source
    on source.license_id = pp.license_id
   and source.id = pp.local_product_ref
   and source.deleted_at is null
  where pp.deleted_at is null
    and portal.slug = 'farmaciagary'
    and pp.configuration_type = 'configurable'
    and pp.has_option_groups is true
    and jsonb_typeof(source.modifiers) = 'array'
    and jsonb_array_length(source.modifiers) > 0
    and nullif(
      pp.metadata->>'ecommerce_configuration_payload_hash',
      ''
    ) is not null
    and pp.metadata->>'ecommerce_configuration_source_revision'
      = 'version:' || source.server_version::text
)
update public.ecommerce_published_products pp
set metadata = (
      coalesce(pp.metadata, '{}'::jsonb)
      - 'ecommerce_configuration_payload_hash'
      - 'ecommerce_configuration_source_revision'
      - 'ecommerce_configuration_rejected_revision'
      - 'ecommerce_configuration_canonical_revision'
    ) || jsonb_build_object(
      'ecommerce_configuration_reseal_reason',
      'modifier_normalizer_contract_20260716',
      'ecommerce_configuration_reseal_requested_at',
      now()
    ),
    sync_status = case
      when pp.sync_error_code in (
        'ECOMMERCE_CATALOG_SOURCE_CONFLICT',
        'ECOMMERCE_CONFIGURATION_SOURCE_REVISION_MISMATCH'
      ) then 'synced'
      else pp.sync_status
    end,
    sync_error_code = case
      when pp.sync_error_code in (
        'ECOMMERCE_CATALOG_SOURCE_CONFLICT',
        'ECOMMERCE_CONFIGURATION_SOURCE_REVISION_MISMATCH'
      ) then null
      else pp.sync_error_code
    end
from affected
where pp.id = affected.id;;
