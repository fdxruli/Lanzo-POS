import { db, STORES } from '../db/dexie';
import { uploadProductImage } from '../storage/imageUploadService';

const DEFAULT_MIGRATION_LIMIT = 25;
const LOCAL_IMAGE_PREFIX = 'img-';

const asText = (value) => String(value ?? '').trim();
const isHttpUrl = (value) => /^https?:\/\//i.test(asText(value));
const isBrowserFile = (value) => typeof File !== 'undefined' && value instanceof File;
const isBlobLike = (value) => typeof Blob !== 'undefined' && value instanceof Blob;

export const isLocalProductImageRef = (value) => asText(value).startsWith(LOCAL_IMAGE_PREFIX);

export const getProductPublicImageUrl = (...records) => {
  for (const record of records) {
    if (!record) continue;
    const candidates = [record.imageUrl, record.image_url, record.image];
    const match = candidates.find(isHttpUrl);
    if (match) return asText(match);
  }
  return null;
};

export const getProductLocalImageRef = (...records) => {
  for (const record of records) {
    if (!record) continue;
    const candidates = [record.imageRef, record.image_ref, record.image];
    const match = candidates.find(isLocalProductImageRef);
    if (match) return asText(match);
  }
  return null;
};

const getExtensionForMimeType = (mimeType = '') => {
  const normalized = asText(mimeType).toLowerCase();
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  return 'jpg';
};

export const localBlobToProductImageFile = (blob, imageRef = 'product-image') => {
  if (isBrowserFile(blob)) return blob;
  if (!isBlobLike(blob)) return null;
  if (typeof File === 'undefined') return null;

  const extension = getExtensionForMimeType(blob.type);
  const safeBaseName = asText(imageRef)
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'product-image';

  return new File([blob], `${safeBaseName}.${extension}`, {
    type: blob.type || 'image/jpeg',
    lastModified: Date.now()
  });
};

const ensureDatabaseOpen = async () => {
  if (!db.isOpen()) await db.open();
};

export const getLocalProductImageBlob = async (imageRef) => {
  if (!isLocalProductImageRef(imageRef)) return null;
  await ensureDatabaseOpen();
  const record = await db.table(STORES.IMAGES).get(imageRef);
  return record?.blob || null;
};

export const listLegacyProductImageCandidates = async ({
  limit = DEFAULT_MIGRATION_LIMIT,
  includeOverflow = false
} = {}) => {
  await ensureDatabaseOpen();
  const safeLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_MIGRATION_LIMIT, 200));
  const queryLimit = includeOverflow ? safeLimit + 1 : safeLimit;

  return db.table(STORES.MENU)
    .filter((product) => (
      product?.isActive !== false
      && !product?.deletedAt
      && !getProductPublicImageUrl(product)
      && Boolean(getProductLocalImageRef(product))
    ))
    .limit(queryLimit)
    .toArray();
};

const buildCloudImageMetadata = ({ existingProduct, productPayload, uploadedImage, source }) => ({
  ...(existingProduct?.metadata || {}),
  ...(productPayload?.metadata || {}),
  images_cloud: true,
  image_strategy: 'cloud_public_url',
  image_migration_source: source,
  image_migration_status: 'completed',
  product_image_storage: {
    bucket: uploadedImage.bucket,
    path: uploadedImage.path,
    mime_type: uploadedImage.mimeType,
    optimized: uploadedImage.optimized,
    original_size_bytes: uploadedImage.originalSizeBytes,
    uploaded_size_bytes: uploadedImage.uploadedSizeBytes,
    uploaded_at: new Date().toISOString()
  }
});

export const prepareProductImageForCloud = async ({
  productData = {},
  existingProduct = null,
  licenseKey,
  cloudEnabled,
  getLocalImage = getLocalProductImageBlob,
  uploadImage = uploadProductImage
}) => {
  const selectedImage = productData?.imageUploadSource || productData?.image;
  const hasSelectedFile = isBrowserFile(selectedImage);
  const existingImageUrl = getProductPublicImageUrl(productData, existingProduct);
  const existingImageRef = getProductLocalImageRef(productData, existingProduct);
  const productPayload = { ...productData };
  delete productPayload.imageUploadSource;

  if (!hasSelectedFile) {
    if (existingImageUrl) productPayload.imageUrl = existingImageUrl;
    if (existingImageRef) productPayload.imageRef = existingImageRef;
  }

  if (!cloudEnabled || !licenseKey) {
    return {
      productPayload,
      status: 'cloud_disabled',
      uploaded: false,
      requiresReselection: false
    };
  }

  if (!hasSelectedFile && existingImageUrl) {
    return {
      productPayload,
      status: 'already_public',
      uploaded: false,
      requiresReselection: false
    };
  }

  let uploadSource = hasSelectedFile ? selectedImage : null;
  let migrationSource = hasSelectedFile ? 'selected_file' : null;

  if (!uploadSource && existingImageRef) {
    const localBlob = await getLocalImage(existingImageRef);
    uploadSource = localBlobToProductImageFile(localBlob, existingImageRef);
    migrationSource = uploadSource ? 'indexeddb_legacy_blob' : null;
  }

  if (!uploadSource) {
    return {
      productPayload,
      status: existingImageRef ? 'missing_local_blob' : 'no_image',
      uploaded: false,
      requiresReselection: Boolean(existingImageRef),
      missingImageRef: existingImageRef
    };
  }

  const uploadedImage = await uploadImage(uploadSource, licenseKey);
  if (!uploadedImage?.publicUrl || !isHttpUrl(uploadedImage.publicUrl)) {
    throw new Error('Storage no devolvió una URL pública válida para la imagen del producto.');
  }

  return {
    productPayload: {
      ...productPayload,
      ...(existingImageRef && !hasSelectedFile ? { imageRef: existingImageRef } : {}),
      imageUrl: uploadedImage.publicUrl,
      metadata: buildCloudImageMetadata({
        existingProduct,
        productPayload,
        uploadedImage,
        source: migrationSource
      })
    },
    status: 'uploaded',
    uploaded: true,
    requiresReselection: false,
    migrationSource,
    uploadedImage
  };
};

export const migrateLegacyProductImages = async ({
  products = null,
  licenseKey,
  cloudEnabled,
  limit = DEFAULT_MIGRATION_LIMIT,
  getLocalImage = getLocalProductImageBlob,
  uploadImage = uploadProductImage,
  saveProduct
}) => {
  const summary = {
    attempted: 0,
    migrated: 0,
    missingLocalBlob: 0,
    failed: 0,
    skipped: 0,
    missingProductNames: [],
    failures: [],
    hasMore: false
  };

  if (!cloudEnabled || !licenseKey || typeof saveProduct !== 'function') {
    summary.skipped += 1;
    return summary;
  }

  const safeLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_MIGRATION_LIMIT, 200));
  const candidatePool = Array.isArray(products)
    ? products.filter((product) => (
        !getProductPublicImageUrl(product)
        && Boolean(getProductLocalImageRef(product))
      ))
    : await listLegacyProductImageCandidates({ limit: safeLimit, includeOverflow: true });
  summary.hasMore = candidatePool.length > safeLimit;
  const candidates = candidatePool.slice(0, safeLimit);

  for (const product of candidates) {
    summary.attempted += 1;
    try {
      const prepared = await prepareProductImageForCloud({
        productData: product,
        existingProduct: product,
        licenseKey,
        cloudEnabled,
        getLocalImage,
        uploadImage
      });

      if (prepared.requiresReselection) {
        summary.missingLocalBlob += 1;
        summary.missingProductNames.push(asText(product?.name) || asText(product?.id) || 'Producto');
        continue;
      }

      if (!prepared.uploaded) {
        summary.skipped += 1;
        continue;
      }

      const saveResult = await saveProduct(prepared.productPayload, product);
      if (saveResult?.success === false) {
        throw new Error(saveResult?.message || 'No se pudo persistir la URL pública del producto.');
      }
      summary.migrated += 1;
    } catch (error) {
      summary.failed += 1;
      summary.failures.push({
        productId: product?.id || null,
        productName: asText(product?.name) || null,
        message: error?.message || 'Error desconocido al migrar imagen.'
      });
    }
  }

  return summary;
};
