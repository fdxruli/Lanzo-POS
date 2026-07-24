-- ECOM.RESET.LEGACY.SOURCE.REVISION.DRIFT
-- Una revisión de catálogo debe corresponder siempre al server_version del
-- producto fuente. Las revisiones infladas por dependencias de inventario se
-- descartan para que el próximo snapshot cloud establezca la firma correcta.

update public.ecommerce_published_products pp
set source_revision = null,
    source_revision_kind = null,
    source_revision_order = null,
    source_payload_hash = null,
    sync_status = 'synced',
    sync_error_code = null,
    last_synced_at = now()
from public.pos_products source
where source.license_id = pp.license_id
  and source.id = pp.local_product_ref
  and source.deleted_at is null
  and pp.deleted_at is null
  and pp.source_revision_kind = 'version'
  and pp.source_revision_order is distinct from source.server_version::numeric;;
