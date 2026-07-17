-- ECOM.CATALOG.REVISION.CONFLICT.RECOVERY
-- Los conflictos existentes se generaron con proyecciones anteriores a la
-- reconciliación de configuración. Se reinicia únicamente su huella de origen;
-- el siguiente snapshot cloud vuelve a establecer una firma canónica.

update public.ecommerce_published_products pp
set source_revision = null,
    source_revision_kind = null,
    source_revision_order = null,
    source_payload_hash = null,
    sync_status = 'synced',
    sync_error_code = null,
    last_synced_at = now(),
    metadata = coalesce(pp.metadata, '{}'::jsonb)
      - 'ecommerce_configuration_rejected_revision'
      - 'ecommerce_configuration_canonical_revision'
where pp.deleted_at is null
  and pp.sync_error_code = 'ECOMMERCE_CATALOG_SOURCE_CONFLICT';

-- La configuración publicada ya es válida; se libera para que la siguiente
-- sincronización la selle con la revisión real del producto padre.
update public.ecommerce_published_products pp
set sync_status = 'synced',
    sync_error_code = null,
    last_synced_at = now(),
    metadata = coalesce(pp.metadata, '{}'::jsonb)
      - 'ecommerce_configuration_rejected_revision'
      - 'ecommerce_configuration_canonical_revision'
where pp.deleted_at is null
  and pp.sync_error_code = 'ECOMMERCE_CONFIGURATION_SOURCE_REVISION_MISMATCH';
