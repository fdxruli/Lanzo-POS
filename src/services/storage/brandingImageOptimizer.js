const WEBP_MIME_TYPE = 'image/webp';

const IMAGE_WEBP_PROFILES = Object.freeze({
  'business-logo': Object.freeze({
    maxWidth: 1024,
    maxHeight: 1024,
    quality: 0.86
  }),
  'business-cover': Object.freeze({
    maxWidth: 1920,
    maxHeight: 1080,
    quality: 0.84
  }),
  'product-image': Object.freeze({
    maxWidth: 1280,
    maxHeight: 1280,
    quality: 0.8
  }),
  'restaurant-item-image': Object.freeze({
    maxWidth: 1280,
    maxHeight: 1280,
    quality: 0.8
  })
});

const CONVERTIBLE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
]);

function getProfile(purpose) {
  return IMAGE_WEBP_PROFILES[String(purpose || '').trim().toLowerCase()] || null;
}

function webpFilename(filename = 'imagen') {
  const cleanName = String(filename || 'imagen').trim() || 'imagen';
  const baseName = cleanName
    .replace(/\.[a-z0-9]+$/iu, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 120) || 'imagen';
  return `${baseName}.webp`;
}

function fittedDimensions(width, height, profile) {
  const scale = Math.min(
    1,
    profile.maxWidth / width,
    profile.maxHeight / height
  );

  return Object.freeze({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  });
}

async function decodeBitmap(file, createImageBitmapImpl) {
  try {
    return await createImageBitmapImpl(file, { imageOrientation: 'from-image' });
  } catch {
    return createImageBitmapImpl(file);
  }
}

function encodeCanvas(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, WEBP_MIME_TYPE, quality);
  });
}

export function brandingWebpProfileFor(purpose) {
  return getProfile(purpose);
}

export async function optimizeBrandingImageToWebp({
  file,
  purpose,
  createImageBitmapImpl = globalThis.createImageBitmap,
  documentImpl = globalThis.document,
  FileImpl = globalThis.File
} = {}) {
  const profile = getProfile(purpose);
  const mimeType = String(file?.type || '').toLowerCase();

  if (
    !profile ||
    !CONVERTIBLE_MIME_TYPES.has(mimeType) ||
    typeof createImageBitmapImpl !== 'function' ||
    typeof documentImpl?.createElement !== 'function' ||
    typeof FileImpl !== 'function'
  ) {
    return file;
  }

  let bitmap = null;
  try {
    bitmap = await decodeBitmap(file, createImageBitmapImpl);
    const sourceWidth = Number(bitmap?.width);
    const sourceHeight = Number(bitmap?.height);
    if (
      !Number.isFinite(sourceWidth) ||
      !Number.isFinite(sourceHeight) ||
      sourceWidth <= 0 ||
      sourceHeight <= 0
    ) {
      return file;
    }

    const dimensions = fittedDimensions(sourceWidth, sourceHeight, profile);
    const canvas = documentImpl.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    const context = canvas.getContext?.('2d', { alpha: true });
    if (!context || typeof context.drawImage !== 'function' || typeof canvas.toBlob !== 'function') {
      return file;
    }

    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
    const blob = await encodeCanvas(canvas, profile.quality);
    if (!blob || blob.size <= 0 || String(blob.type || '').toLowerCase() !== WEBP_MIME_TYPE) {
      return file;
    }

    return new FileImpl([blob], webpFilename(file.name), {
      type: WEBP_MIME_TYPE,
      lastModified: Number.isFinite(file.lastModified) ? file.lastModified : Date.now()
    });
  } catch {
    return file;
  } finally {
    try {
      bitmap?.close?.();
    } catch {
      // Releasing a decoded bitmap must not block the upload fallback.
    }
  }
}
