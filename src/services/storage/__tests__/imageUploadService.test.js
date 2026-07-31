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

import {
  IMAGE_UPLOAD_PURPOSES,
  uploadImageFile
} from '../imageUploadService';

class TestFile extends Blob {
  constructor(parts, name, options = {}) {
    super(parts, options);
    this.name = name;
    this.lastModified = options.lastModified || 0;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('File', TestFile);
  mocks.checkInternetConnection.mockResolvedValue(true);
  mocks.getStableDeviceId.mockResolvedValue('device-fixture');
  mocks.getDeviceSecurityToken.mockResolvedValue('security-fixture');
  mocks.getActorSessionToken.mockResolvedValue(null);
  mocks.storageFrom.mockReturnValue({
    uploadToSignedUrl: mocks.uploadToSignedUrl,
    getPublicUrl: mocks.getPublicUrl
  });
  mocks.uploadToSignedUrl.mockResolvedValue({ error: null });
  mocks.getPublicUrl.mockReturnValue({
    data: { publicUrl: 'https://storage.test/public_uploads/branding.webp' }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('imageUploadService branding normalization', () => {
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
    mocks.invoke.mockResolvedValue({
      data: {
        success: true,
        bucket: 'images',
        path: 'public_uploads/hash/business-cover/id.webp',
        public_url_path: 'public_uploads/hash/business-cover/id.webp',
        token: 'signed-token',
        mime_type: 'image/webp',
        max_size_bytes: 5 * 1024 * 1024
      },
      error: null
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
        size_bytes: optimized.size
      })
    });
    expect(mocks.uploadToSignedUrl).toHaveBeenCalledWith(
      'public_uploads/hash/business-cover/id.webp',
      'signed-token',
      optimized,
      {
        cacheControl: '3600',
        contentType: 'image/webp',
        upsert: false
      }
    );
    expect(result).toEqual(expect.objectContaining({
      mimeType: 'image/webp',
      purpose: 'business-cover',
      optimized: true
    }));
  });

  it('conserva el archivo original cuando la optimización no está disponible', async () => {
    const original = new TestFile(['original-png'], 'portada.png', {
      type: 'image/png'
    });
    const imageOptimizer = vi.fn(async () => {
      throw new Error('canvas unavailable');
    });
    mocks.invoke.mockResolvedValue({
      data: {
        success: true,
        bucket: 'images',
        path: 'public_uploads/hash/business-cover/id.png',
        public_url_path: 'public_uploads/hash/business-cover/id.png',
        token: 'signed-token',
        mime_type: 'image/png',
        max_size_bytes: 5 * 1024 * 1024
      },
      error: null
    });

    const result = await uploadImageFile({
      file: original,
      licenseKey: 'license-fixture',
      purpose: IMAGE_UPLOAD_PURPOSES.BUSINESS_COVER,
      imageOptimizer
    });

    expect(mocks.invoke).toHaveBeenCalledWith('authorize-image-upload', {
      body: expect.objectContaining({
        filename: 'portada.png',
        mime_type: 'image/png'
      })
    });
    expect(mocks.uploadToSignedUrl).toHaveBeenCalledWith(
      'public_uploads/hash/business-cover/id.png',
      'signed-token',
      original,
      expect.objectContaining({ contentType: 'image/png' })
    );
    expect(result.optimized).toBe(false);
    expect(mocks.warn).toHaveBeenCalledWith(
      '[Storage] No se pudo optimizar la imagen de marca; se usará el archivo original.'
    );
  });
});
