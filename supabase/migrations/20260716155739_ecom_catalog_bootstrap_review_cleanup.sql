-- HOTFIX ECOM.CATALOG.BOOTSTRAP.REVIEW.CLEANUP
-- Retira el estado técnico de revisión generado durante la autocorrección
-- inicial, sin desactivar la protección permanente del trigger.

alter table public.ecommerce_published_products
  disable trigger zz_ecommerce_recipe_projection_guard;

update public.ecommerce_published_products pp
set sync_status = 'synced',
    sync_error_code = null,
    last_synced_at = now(),
    source_revision = null,
    source_revision_kind = null,
    source_revision_order = null,
    source_payload_hash = null,
    metadata = coalesce(pp.metadata, '{}'::jsonb)
      - 'recipe_projection_corrected_at'
      - 'recipe_projection_incoming_state'
      - 'recipe_projection_canonical_state'
where pp.deleted_at is null
  and pp.has_recipe is true
  and pp.availability_source = 'recipe'
  and pp.sync_error_code = 'ECOMMERCE_RECIPE_SOURCE_MISMATCH';

alter table public.ecommerce_published_products
  enable trigger zz_ecommerce_recipe_projection_guard;
