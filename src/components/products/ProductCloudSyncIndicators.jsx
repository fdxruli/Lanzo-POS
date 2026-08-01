import { resolveProductCloudSyncBadge } from '../../services/products/productConstants';
import './ProductCloudSyncIndicators.css';

const asText = (value) => String(value ?? '').trim();
const isHttpUrl = (value) => /^https?:\/\//i.test(asText(value));
const isLocalImageRef = (value) => asText(value).startsWith('img-');

export const resolveProductImageCloudSyncBadge = (product = {}) => {
  const metadata = product?.metadata || {};
  const imageUrl = [product.imageUrl, product.image_url, product.image].find(isHttpUrl);
  const imageRef = [product.imageRef, product.image_ref, product.image].find(isLocalImageRef);
  const migrationStatus = asText(metadata.image_migration_status).toLowerCase();

  if (migrationStatus === 'failed' || migrationStatus === 'error') {
    return {
      status: 'error',
      label: 'Imagen: Error',
      title: 'La imagen no pudo sincronizarse. Edita el producto para reintentar o volver a seleccionarla.'
    };
  }

  if (imageUrl) {
    return {
      status: 'synced',
      label: 'Imagen: Pública',
      title: 'La URL pública de la imagen está guardada en Supabase.'
    };
  }

  if (imageRef) {
    return {
      status: 'pending',
      label: 'Imagen: Pendiente',
      title: 'La imagen existe en este dispositivo, pero todavía no tiene una URL pública en Supabase.'
    };
  }

  return {
    status: 'empty',
    label: 'Imagen: Sin imagen',
    title: 'Este producto no tiene una imagen asignada.'
  };
};

export default function ProductCloudSyncIndicators({ product }) {
  const productBadge = resolveProductCloudSyncBadge(product);
  const imageBadge = resolveProductImageCloudSyncBadge(product);

  return (
    <div className="product-cloud-sync-indicators" aria-label="Estado de sincronización cloud">
      <span
        className={`product-cloud-sync-badge product-cloud-sync-badge--${productBadge.status}`}
        title={productBadge.title}
      >
        <span className="product-cloud-sync-badge__dot" aria-hidden="true" />
        Producto: {productBadge.label}
      </span>
      <span
        className={`product-cloud-sync-badge product-cloud-sync-badge--${imageBadge.status}`}
        title={imageBadge.title}
      >
        <span className="product-cloud-sync-badge__dot" aria-hidden="true" />
        {imageBadge.label}
      </span>
    </div>
  );
}
