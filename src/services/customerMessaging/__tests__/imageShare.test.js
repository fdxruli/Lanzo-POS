import { describe, expect, it, vi } from 'vitest';
import { downloadCustomerMessageImage, shareCustomerMessageImage } from '../imageShare';

const imageResult = {
  ok: true,
  blob: new Blob(['png'], { type: 'image/png' }),
  file: { name: 'receipt.png', type: 'image/png' },
  filename: 'receipt.png'
};

const downloadEnvironment = () => {
  const anchor = { click: vi.fn(), remove: vi.fn(), style: {} };
  const documentRef = { createElement: vi.fn(() => anchor), body: { appendChild: vi.fn() } };
  const urlApi = { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() };
  return { anchor, documentRef, urlApi };
};

describe('customer message image sharing', () => {
  it('shares only a file and title when Web Share is available', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const navigatorRef = { canShare: vi.fn(() => true), share };
    const result = await shareCustomerMessageImage(imageResult, { navigatorRef });
    expect(result.status).toBe('shared');
    expect(share).toHaveBeenCalledWith({ files: [imageResult.file], title: 'Comprobante de Lanzo POS' });
    expect(share.mock.calls[0][0]).not.toHaveProperty('text');
    expect(share.mock.calls[0][0]).not.toHaveProperty('url');
  });

  it('reports user cancellation without downloading or throwing', async () => {
    const error = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const result = await shareCustomerMessageImage(imageResult, {
      navigatorRef: { canShare: () => true, share: vi.fn().mockRejectedValue(error) }
    });
    expect(result.status).toBe('cancelled');
  });

  it('reports browser share errors separately', async () => {
    const result = await shareCustomerMessageImage(imageResult, {
      navigatorRef: { canShare: () => true, share: vi.fn().mockRejectedValue(new Error('browser failed')) }
    });
    expect(result).toMatchObject({ status: 'failed', code: 'IMAGE_SHARE_FAILED' });
  });

  it.each([
    ['no share API', {}],
    ['canShare false', { canShare: () => false, share: vi.fn() }]
  ])('downloads when %s', async (_label, navigatorRef) => {
    const env = downloadEnvironment();
    const result = await shareCustomerMessageImage(imageResult, { navigatorRef, ...env });
    expect(result.status).toBe('downloaded');
    expect(env.anchor.click).toHaveBeenCalledOnce();
    expect(env.urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });

  it('does not use window.open or create a text URL', () => {
    const env = downloadEnvironment();
    downloadCustomerMessageImage(imageResult, env);
    expect(env.anchor.href).toBe('blob:test');
    expect(env.anchor.href).not.toContain('?text=');
  });

  it('is independent from customer phone data', async () => {
    const result = await shareCustomerMessageImage(imageResult, {
      navigatorRef: { canShare: () => true, share: vi.fn().mockResolvedValue(undefined) }
    });
    expect(result.status).toBe('shared');
  });
});

