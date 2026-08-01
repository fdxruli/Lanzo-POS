// @vitest-environment jsdom
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

import { uploadImageFile, IMAGE_UPLOAD_PURPOSES } from '../imageUploadService';

class TestFile extends Blob {
  constructor(parts, name, options = {}) {
    super(parts, options);
    this.name = name;
    this.lastModified = options.lastModified || 0;
  }
}

const functionError = (status, payload) => ({
  name: 'FunctionsHttpError',
  message: 'Edge Function returned a non-2xx status code',
  context: {
    status,
    clone: () => ({ json: async () => payload }),
    json: async () => payload
  }
});

const authorizedResult = {
  data: {
    success: true,
    bucket: 'images',
    path: 'public_uploads/hash/product-image/product.webp',
    public_url_path: 'public_uploads/hash/product-image/product.webp',
    token: 'signed-token',
    mime_type: 'image/webp',
    max_size_bytes: 4 * 1024 * 1024
  },
  error: null
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('File', TestFile);
  mocks.checkInternetConnection.mockResolvedValue(true);
  mocks.getStableDeviceId.mockResolvedValue('device-fixture');
  mocks.getDeviceSecurityToken.mockResolvedValue('security-fixture');
  mocks.getActorSessionToken.mockResolvedValue('residual-session-token');
  mocks.storageFrom.mockReturnValue({
    uploadToSignedUrl: mocks.uploadToSignedUrl,
    getPublicUrl: mocks.getPublicUrl
  });
  mocks.uploadToSignedUrl.mockResolvedValue({ error: null });
  mocks.getPublicUrl.mockReturnValue({
    data: { publicUrl: 'https://project.supabase.co/storage/v1/object/public/images/public_uploads/hash/product-image/product.webp' }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('imageUploadService actor session recovery', () => {
  it('retries once without a residual actor token after a 403 authorization rejection', async () => {
    mocks.invoke
      .mockResolvedValueOnce({
        data: null,
        error: functionError(403, {
          success: false,
          code: 'STORAGE_UPLOAD_NOT_ALLOWED',
          message: 'No tienes permiso para subir esta imagen.'
        })
      })
      .mockResolvedValueOnce(authorizedResult);

    const file = new TestFile(['webp-image'], 'product.webp', { type: 'image/webp' });
    const result = await uploadImageFile({
      file,
      licenseKey: 'license-fixture',
      purpose: IMAGE_UPLOAD_PURPOSES.PRODUCT_IMAGE,
      imageOptimizer: vi.fn(async () => file)
    });

    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke.mock.calls[0][1].body.staff_session_token).toBe('residual-session-token');
    expect(mocks.invoke.mock.calls[1][1].body.staff_session_token).toBeNull();
    expect(result.publicUrl).toContain('/storage/v1/object/public/images/');
    expect(mocks.warn).toHaveBeenCalledWith(
      '[Storage] Sesión residual rechazada; reintentando autorización sin sesión de actor.',
      { code: 'STORAGE_UPLOAD_NOT_ALLOWED' }
    );
  });

  it('surfaces the structured function error after the recovery retry also fails', async () => {
    mocks.invoke
      .mockResolvedValueOnce({
        data: null,
        error: functionError(403, { code: 'STORAGE_UPLOAD_NOT_ALLOWED' })
      })
      .mockResolvedValueOnce({
        data: null,
        error: functionError(429, {
          code: 'STORAGE_UPLOAD_RATE_LIMITED',
          message: 'Demasiados intentos al subir imágenes.'
        })
      });

    const file = new TestFile(['webp-image'], 'product.webp', { type: 'image/webp' });

    await expect(uploadImageFile({
      file,
      licenseKey: 'license-fixture',
      purpose: IMAGE_UPLOAD_PURPOSES.PRODUCT_IMAGE,
      imageOptimizer: vi.fn(async () => file)
    })).rejects.toMatchObject({
      code: 'STORAGE_UPLOAD_RATE_LIMITED'
    });
  });
});
