import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  uploadToSignedUrl: vi.fn(),
  getPublicUrl: vi.fn(),
  storageFrom: vi.fn(),
  checkInternetConnection: vi.fn(),
  getStableDeviceId: vi.fn(),
  getDeviceSecurityToken: vi.fn(),
  getActorSessionToken: vi.fn(),
  warn: vi.fn()
}));

vi.mock('../../supabase', () => ({
  getStableDeviceId: mocks.getStableDeviceId,
  getDeviceSecurityToken: mocks.getDeviceSecurityToken,
  getActorSessionToken: mocks.getActorSessionToken,
  supabaseClient: {
    functions: { invoke: mocks.invoke },
    storage: { from: mocks.storageFrom }
  }
}));

vi.mock('../../utils', () => ({
  checkInternetConnection: mocks.checkInternetConnection
}));

vi.mock('../../Logger', () => ({
  default: { warn: mocks.warn }
}));

vi.mock('../brandingImageOptimizer', () => ({
  optimizeBrandingImageToWebp: vi.fn(async ({ file }) => new File(
    ['sanitized-webp'],
    file.name.replace(/\.[^.]+$/, '.webp'),
    { type: 'image/webp' }
  ))
}));

import {
  IMAGE_UPLOAD_PURPOSES,
  uploadImageFile,
  uploadProductImage
} from '../imageUploadService';

class TestFile extends Blob {
  constructor(parts, name, options = {}) {
    super(parts, options);
    this.name = name;
    this.lastModified = options.lastModified || 0;
  }
}

const authorizeUpload = ({
  purpose = 'business-cover',
  filename = 'id.webp',
  maxSizeBytes = 5 * 1024 * 1024
} = {}) => {
  const path = `public_uploads/hash/${purpose}/${filename}`;
  mocks.invoke.mockResolvedValue({
    data: {
      success: true,
      bucket: 'images',
      path,
      public_url_path: path,
      token: 'signed-token',
      mime_type: filename.endsWith('.webp') ? 'image/webp' : 'image/png',
      max_size_bytes: maxSizeBytes
    },
    error: null
  });
  return path;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('File', TestFile);
  mocks.checkInternetConnection.mockResolvedValue(true);
  mocks.getStableDeviceId.mockResolvedValue('device-fixture');
  mocks.getDeviceSecurityToken.mockResolvedValue('security-fixture');
  mocks.getActorSessionToken.mockResolvedValue('staff-session-fixture');
  mocks.storageFrom.mockReturnValue({
    uploadToSignedUrl: mocks.uploadToSignedUrl,
    getPublicUrl: mocks.getPublicUrl
  });
  mocks.uploadToSignedUrl.mockResolvedValue({ error: null });
  mocks.getPublicUrl.mockReturnValue({
    data: { publicUrl: 'https://storage.test/public_uploads/image.webp' }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('imageUploadService image normalization', () => {
  it('autoriza y sube el WebP optimizado en lugar del PNG original', async () => {
    const original = new TestFile(['original-png'], 'portada.png', {
      type: 'image/png',
      lastModified: 100
    });
    const optimized = new TestFile(['optimized-webp'], 'portada.webp', {
      type: 'image/webp',
      lastModified: 100
    });
    const imageOptimizer = vi.fn(async () => optimized);
    const path = authorizeUpload({
      purpose: 'business-cover',
      filename: 'id.webp'
    });

    const result = await uploadImageFile({
      file: original,
      licenseKey: 'license-fixture',
      purpose: IMAGE_UPLOAD_PURPOSES.BUSINESS_COVER,
      imageOptimizer
    });

    expect(imageOptimizer).toHaveBeenCalledWith({
      file: original,
      purpose: IMAGE_UPLOAD_PURPOSES.BUSINESS_COVER
    });
    expect(mocks.invoke).toHaveBeenCalledWith('authorize-image-upload', {
      body: expect.objectContaining({
        purpose: 'business-cover',
        filename: 'portada.webp',
        mime_type: 'image/webp',
        size_bytes: optimized.size,
        staff_session_token: 'staff-session-fixture'
      })
    });
    expect(mocks.uploadToSignedUrl).toHaveBeenCalledWith(
      path,
      'signed-token',
      optimized,
      {
        cacheControl: '31536000',
        contentType: 'image/webp',
        upsert: false
      }
    );
    expect(result).toEqual(expect.objectContaining({
      mimeType: 'image/webp',
      purpose: 'business-cover',
      optimized: true,
      originalSizeBytes: original.size,
      uploadedSizeBytes: optimized.size
    }));
  });

  it('acepta una foto original mayor a 4 MB cuando el WebP final cumple el límite', async () => {
    const original = new TestFile(
      [new Uint8Array(5 * 1024 * 1024)],
      'electrolit-fresa.jpg',
      { type: 'image/jpeg', lastModified: 200 }
    );
    const optimized = new TestFile(
      [new Uint8Array(320 * 1024)],
      'electrolit-fresa.webp',
      { type: 'image/webp', lastModified: 200 }
    );
    const imageOptimizer = vi.fn(async () => optimized);
    const path = authorizeUpload({
      purpose: 'product-image',
      filename: 'product.webp',
      maxSizeBytes: 4 * 1024 * 1024
    });

    const result = await uploadImageFile({
      file: original,
      licenseKey: 'license-fixture',
      purpose: IMAGE_UPLOAD_PURPOSES.PRODUCT_IMAGE,
      imageOptimizer
    });

    expect(mocks.invoke).toHaveBeenCalledWith('authorize-image-upload', {
      body: expect.objectContaining({
        purpose: 'product-image',
        filename: 'electrolit-fresa.webp',
        mime_type: 'image/webp',
        size_bytes: optimized.size,
        staff_session_token: 'staff-session-fixture'
      })
    });
    expect(mocks.uploadToSignedUrl).toHaveBeenCalledWith(
      path,
      'signed-token',
      optimized,
      expect.objectContaining({ contentType: 'image/webp' })
    );
    expect(result).toEqual(expect.objectContaining({
      publicUrl: 'https://storage.test/public_uploads/image.webp',
      purpose: 'product-image',
      optimized: true,
      originalSizeBytes: original.size,
      uploadedSizeBytes: optimized.size
    }));
  });

  it('rechaza el producto si después de optimizar todavía supera 4 MB', async () => {
    const original = new TestFile(
      [new Uint8Array(5 * 1024 * 1024)],
      'producto.jpg',
      { type: 'image/jpeg' }
    );
    const stillTooLarge = new TestFile(
      [new Uint8Array(4 * 1024 * 1024 + 1)],
      'producto.webp',
      { type: 'image/webp' }
    );

    await expect(uploadImageFile({
      file: original,
      licenseKey: 'license-fixture',
      purpose: IMAGE_UPLOAD_PURPOSES.PRODUCT_IMAGE,
      imageOptimizer: vi.fn(async () => stillTooLarge)
    })).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' });

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it('usa product-image al invocar el helper específico de productos', async () => {
    const webp = new TestFile(['small-webp'], 'producto.webp', {
      type: 'image/webp'
    });
    authorizeUpload({
      purpose: 'product-image',
      filename: 'product.webp',
      maxSizeBytes: 4 * 1024 * 1024
    });

    const result = await uploadProductImage(webp, 'license-fixture');

    expect(mocks.invoke).toHaveBeenCalledWith('authorize-image-upload', {
      body: expect.objectContaining({
        purpose: 'product-image',
        filename: 'producto.webp',
        mime_type: 'image/webp',
        staff_session_token: 'staff-session-fixture'
      })
    });
    expect(result.purpose).toBe('product-image');
  });

  it('rechaza el original cuando falla la conversión y no solicita autorización', async () => {
    const original = new TestFile(['raw-exif-gps'], 'portada.jpg', { type: 'image/jpeg' });

    await expect(uploadImageFile({
      file: original,
      licenseKey: 'license-fixture',
      purpose: IMAGE_UPLOAD_PURPOSES.BUSINESS_COVER,
      imageOptimizer: vi.fn(async () => { throw new Error('canvas unavailable'); })
    })).rejects.toMatchObject({ code: 'IMAGE_PROCESSING_FAILED' });

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.uploadToSignedUrl).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(
      '[Storage] No se pudo sanitizar la imagen; la subida se canceló.'
    );
  });

  it.each(['product-image', 'business-logo', 'business-cover', 'category-image', 'profile-image', 'misc'])(
    'rechaza un archivo sin recodificar (%s), incluso si ya es WebP',
    async (purpose) => {
      const original = new TestFile(['original-with-metadata'], 'image.webp', { type: 'image/webp' });

      await expect(uploadImageFile({
        file: original,
        licenseKey: 'license-fixture',
        purpose,
        imageOptimizer: vi.fn(async () => original)
      })).rejects.toMatchObject({ code: 'IMAGE_PROCESSING_FAILED' });

      expect(mocks.invoke).not.toHaveBeenCalled();
      expect(mocks.uploadToSignedUrl).not.toHaveBeenCalled();
    }
  );

  it('rechaza una conversión con MIME distinto de WebP antes de solicitar autorización', async () => {
    const source = new TestFile(['original'], 'producto.png', { type: 'image/png' });
    const candidate = new TestFile(['png-no-sanitizado'], 'producto.png', { type: 'image/png' });

    await expect(uploadImageFile({
      file: source,
      licenseKey: 'license-fixture',
      purpose: IMAGE_UPLOAD_PURPOSES.PRODUCT_IMAGE,
      imageOptimizer: vi.fn(async () => candidate)
    })).rejects.toMatchObject({ code: 'IMAGE_PROCESSING_FAILED' });

    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('rechaza GIF con mensaje claro, sin enviar datos originales al servidor', async () => {
    const original = new TestFile(['GIF89a-metadata'], 'animacion.gif', { type: 'image/gif' });
    await expect(uploadImageFile({
      file: original,
      licenseKey: 'license-fixture',
      purpose: IMAGE_UPLOAD_PURPOSES.PRODUCT_IMAGE
    })).rejects.toMatchObject({ code: 'IMAGE_PRIVACY_UNSUPPORTED' });

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it('falla si Storage no devuelve una URL pública', async () => {
    const source = new TestFile(['source'], 'producto.webp', {
      type: 'image/webp'
    });
    authorizeUpload({
      purpose: 'product-image',
      filename: 'product.webp',
      maxSizeBytes: 4 * 1024 * 1024
    });
    mocks.getPublicUrl.mockReturnValue({ data: { publicUrl: null } });

    await expect(uploadProductImage(source, 'license-fixture'))
      .rejects.toMatchObject({ code: 'STORAGE_UPLOAD_FAILED' });
  });

  it('keeps a short cache TTL for non-catalog image purposes', async () => {
    const original = new TestFile(['avatar'], 'avatar.webp', { type: 'image/webp' });
    const path = authorizeUpload({
      purpose: 'profile-image',
      filename: 'avatar.webp',
      maxSizeBytes: 2 * 1024 * 1024
    });

    const sanitized = new TestFile(['reencoded-avatar'], 'avatar.webp', { type: 'image/webp' });
    await uploadImageFile({
      file: original,
      licenseKey: 'license-fixture',
      purpose: IMAGE_UPLOAD_PURPOSES.PROFILE_IMAGE,
      imageOptimizer: vi.fn(async () => sanitized)
    });

    expect(mocks.uploadToSignedUrl).toHaveBeenCalledWith(
      path,
      'signed-token',
      sanitized,
      expect.objectContaining({ cacheControl: '3600', upsert: false })
    );
  });
});
