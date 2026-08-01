import { uploadProductImage } from '../storage/imageUploadService';

const asText = (value) => String(value ?? '').trim();

export function isBrowserImageFile(value, FileImpl = globalThis.File) {
  return typeof FileImpl === 'function' && value instanceof FileImpl;
}

export async function prepareProductCloudImagePayload({
  productData,
  productToEdit = null,
  cloudEnabled = false,
  licenseKey = null,
  uploadProductImageImpl = uploadProductImage,
  FileImpl = globalThis.File,
  now = () => new Date().toISOString()
} = {}) {
  const source = productData && typeof productData === 'object' ? productData : {};
  const selectedImage = source.image;

  if (cloudEnabled && isBrowserImageFile(selectedImage, FileImpl)) {
    const uploadedImage = await uploadProductImageImpl(selectedImage, licenseKey);
    const publicUrl = asText(uploadedImage?.publicUrl);
    if (!publicUrl) {
      const error = new Error('No se pudo obtener la URL pública de la imagen del producto.');
      error.code = 'PRODUCT_IMAGE_PUBLIC_URL_MISSING';
      throw error;
    }

    return {
      ...source,
      imageUrl: publicUrl,
      metadata: {
        ...(productToEdit?.metadata || {}),
        ...(source.metadata || {}),
        images_cloud: true,
        image_strategy: 'cloud_public_url',
        product_image_storage: {
          bucket: uploadedImage.bucket || null,
          path: uploadedImage.path || null,
          mime_type: uploadedImage.mimeType || null,
          optimized: uploadedImage.optimized === true,
          original_size_bytes: uploadedImage.originalSizeBytes ?? null,
          uploaded_size_bytes: uploadedImage.uploadedSizeBytes ?? null,
          uploaded_at: now()
        }
      }
    };
  }

  if (!productToEdit) return source;

  const existingImageUrl = asText(
    source.imageUrl
    || source.image_url
    || productToEdit.imageUrl
    || productToEdit.image_url
  ) || null;
  const existingImageRef = asText(
    source.imageRef
    || source.image_ref
    || productToEdit.imageRef
    || productToEdit.image_ref
  ) || null;

  if (!existingImageUrl && !existingImageRef) return source;

  return {
    ...source,
    imageUrl: existingImageUrl,
    imageRef: existingImageRef
  };
}
