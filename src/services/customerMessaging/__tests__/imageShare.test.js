import { describe, expect, it, vi } from 'vitest';
import {
  downloadCustomerMessageImage,
  IMAGE_SHARE_UI_COPY,
  shareCustomerMessageImage
} from '../imageShare';

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
    const env = downloadEnvironment();
    const result = await shareCustomerMessageImage(imageResult, {
      navigatorRef: { canShare: () => true, share: vi.fn().mockRejectedValue(error) },
      ...env
    });
    expect(result.status).toBe('cancelled');
    expect(env.urlApi.createObjectURL).not.toHaveBeenCalled();
    expect(env.anchor.click).not.toHaveBeenCalled();
  });

  it('reports browser share errors with an explicit manual download path', async () => {
    const env = downloadEnvironment();
    const result = await shareCustomerMessageImage(imageResult, {
      navigatorRef: { canShare: () => true, share: vi.fn().mockRejectedValue(new Error('browser failed')) },
      ...env
    });
    expect(result).toMatchObject({ status: 'failed', code: 'IMAGE_SHARE_FAILED', canDownload: true });
    expect(env.urlApi.createObjectURL).not.toHaveBeenCalled();

    const downloadResult = downloadCustomerMessageImage(imageResult, env);
    expect(downloadResult.status).toBe('downloaded');
    expect(env.urlApi.createObjectURL).toHaveBeenCalledWith(imageResult.blob);
    expect(env.anchor.click).toHaveBeenCalledOnce();
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

  it('explains automatic download as an informational browser fallback', () => {
    expect(IMAGE_SHARE_UI_COPY.downloaded).toBe('Este navegador no permite compartir archivos directamente. La imagen fue descargada para adjuntarla manualmente.');
    expect(IMAGE_SHARE_UI_COPY.downloaded).not.toMatch(/operacion financiera|fallo/i);
  });

  it('does not use window.open or create a text URL', () => {
    const env = downloadEnvironment();
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    downloadCustomerMessageImage(imageResult, env);
    expect(env.anchor.href).toBe('blob:test');
    expect(env.anchor.href).not.toContain('?text=');
    expect(open).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('is independent from customer phone data', async () => {
    const result = await shareCustomerMessageImage(imageResult, {
      navigatorRef: { canShare: () => true, share: vi.fn().mockResolvedValue(undefined) }
    });
    expect(result.status).toBe('shared');
  });

  it('keeps image-route UI copy free from WhatsApp references', () => {
    expect(Object.values(IMAGE_SHARE_UI_COPY).join(' ')).not.toMatch(/whatsapp/i);
    expect(IMAGE_SHARE_UI_COPY.failed).toContain('operacion financiera se conservo');
    expect(IMAGE_SHARE_UI_COPY.downloadAction).toBe('Descargar imagen');
  });
});
