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

const uploadFixture = () => {
  const file = new TestFile(['webp-image'], 'product.webp', { type: 'image/webp' });
  return uploadImageFile({
    file,
    licenseKey: 'license-fixture',
    purpose: IMAGE_UPLOAD_PURPOSES.PRODUCT_IMAGE,
    imageOptimizer: vi.fn(async () => file)
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('File', TestFile);
  mocks.checkInternetConnection.mockResolvedValue(true);
  mocks.getStableDeviceId.mockResolvedValue('device-fixture');
  mocks.getDeviceSecurityToken.mockResolvedValue('security-fixture');
  mocks.getActorSessionToken.mockResolvedValue('actor-session-token');
  mocks.storageFrom.mockReturnValue({
    uploadToSignedUrl: mocks.uploadToSignedUrl,
    getPublicUrl: mocks.getPublicUrl
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('imageUploadService actor session authorization', () => {
  it('never retries a rejected actor session without the actor credential', async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: functionError(403, {
        success: false,
        code: 'STORAGE_UPLOAD_NOT_ALLOWED',
        message: 'No tienes permiso para subir esta imagen.'
      })
    });

    await expect(uploadFixture()).rejects.toMatchObject({
      code: 'STORAGE_UPLOAD_NOT_ALLOWED'
    });

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke.mock.calls[0][1].body.staff_session_token).toBe('actor-session-token');
    expect(mocks.uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it('fails before authorization when no unambiguous actor session exists', async () => {
    mocks.getActorSessionToken.mockResolvedValueOnce(null);

    await expect(uploadFixture()).rejects.toMatchObject({
      code: 'SECURE_CONTEXT_REQUIRED'
    });

    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('fails closed when the actor session token is invalid', async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: functionError(403, {
        success: false,
        code: 'ACTOR_SESSION_INVALID',
        message: 'Actor session invalid.'
      })
    });

    await expect(uploadFixture()).rejects.toMatchObject({
      code: 'ACTOR_SESSION_INVALID'
    });

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it('fails closed when Admin and Staff evidence is ambiguous', async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: functionError(403, {
        success: false,
        code: 'ACTOR_SESSION_AMBIGUOUS',
        message: 'Actor session ambiguous.'
      })
    });

    await expect(uploadFixture()).rejects.toMatchObject({
      code: 'ACTOR_SESSION_AMBIGUOUS'
    });

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it('fails closed when the actor session belongs to another tenant', async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: functionError(403, {
        success: false,
        code: 'ACTOR_SESSION_INVALID',
        message: 'Actor does not belong to this tenant.'
      })
    });

    await expect(uploadFixture()).rejects.toMatchObject({
      code: 'ACTOR_SESSION_INVALID'
    });

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke.mock.calls[0][1].body.license_key).toBe('license-fixture');
    expect(mocks.uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it('surfaces structured function errors without changing actor authority', async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: functionError(429, {
        code: 'STORAGE_UPLOAD_RATE_LIMITED',
        message: 'Demasiados intentos al subir imágenes.'
      })
    });

    await expect(uploadFixture()).rejects.toMatchObject({
      code: 'STORAGE_UPLOAD_RATE_LIMITED'
    });

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke.mock.calls[0][1].body.staff_session_token).toBe('actor-session-token');
  });
});
