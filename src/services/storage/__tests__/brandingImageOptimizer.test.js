import { describe, expect, it, vi } from 'vitest';
import {
  brandingWebpProfileFor,
  optimizeBrandingImageToWebp
} from '../brandingImageOptimizer';

class TestFile extends Blob {
  constructor(parts, name, options = {}) {
    super(parts, options);
    this.name = name;
    this.lastModified = options.lastModified || 0;
  }
}

function createRasterHarness({ width, height, outputType = 'image/webp' }) {
  const close = vi.fn();
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ drawImage })),
    toBlob: vi.fn((callback, type) => {
      callback(new Blob(['optimized-image'], { type: outputType || type }));
    })
  };

  return {
    close,
    drawImage,
    canvas,
    createImageBitmapImpl: vi.fn(async () => ({ width, height, close })),
    documentImpl: { createElement: vi.fn(() => canvas) }
  };
}

describe('brandingImageOptimizer', () => {
  it('define perfiles acotados para marca y productos', () => {
    expect(brandingWebpProfileFor('business-logo')).toEqual({
      maxWidth: 1024,
      maxHeight: 1024,
      quality: 0.86
    });
    expect(brandingWebpProfileFor('business-cover')).toEqual({
      maxWidth: 1920,
      maxHeight: 1080,
      quality: 0.84
    });
    expect(brandingWebpProfileFor('product-image')).toEqual({
      maxWidth: 1280,
      maxHeight: 1280,
      quality: 0.8
    });
    expect(brandingWebpProfileFor('restaurant-item-image')).toEqual({
      maxWidth: 1280,
      maxHeight: 1280,
      quality: 0.8
    });
  });

  it('convierte y reduce una portada a WebP sin deformarla', async () => {
    const harness = createRasterHarness({ width: 2400, height: 1200 });
    const source = new TestFile(['source'], 'portada.png', {
      type: 'image/png',
      lastModified: 123
    });

    const result = await optimizeBrandingImageToWebp({
      file: source,
      purpose: 'business-cover',
      createImageBitmapImpl: harness.createImageBitmapImpl,
      documentImpl: harness.documentImpl,
      FileImpl: TestFile
    });

    expect(result).not.toBe(source);
    expect(result.name).toBe('portada.webp');
    expect(result.type).toBe('image/webp');
    expect(result.lastModified).toBe(123);
    expect(harness.canvas.width).toBe(1920);
    expect(harness.canvas.height).toBe(960);
    expect(harness.drawImage).toHaveBeenCalledWith(
      expect.any(Object),
      0,
      0,
      1920,
      960
    );
    expect(harness.canvas.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      'image/webp',
      0.84
    );
    expect(harness.close).toHaveBeenCalledOnce();
  });

  it('no amplía un logo pequeño y conserva transparencia mediante canvas', async () => {
    const harness = createRasterHarness({ width: 320, height: 640 });
    const source = new TestFile(['source'], 'logo.PNG', { type: 'image/png' });

    const result = await optimizeBrandingImageToWebp({
      file: source,
      purpose: 'business-logo',
      createImageBitmapImpl: harness.createImageBitmapImpl,
      documentImpl: harness.documentImpl,
      FileImpl: TestFile
    });

    expect(result.name).toBe('logo.webp');
    expect(harness.canvas.width).toBe(320);
    expect(harness.canvas.height).toBe(640);
    expect(harness.canvas.getContext).toHaveBeenCalledWith('2d', { alpha: true });
  });

  it('normaliza el nombre del logo para la ruta segura de Storage', async () => {
    const harness = createRasterHarness({ width: 320, height: 320 });
    const source = new TestFile(['source'], 'Logo del Niño..final (2).PNG', { type: 'image/png' });

    const result = await optimizeBrandingImageToWebp({
      file: source,
      purpose: 'business-logo',
      createImageBitmapImpl: harness.createImageBitmapImpl,
      documentImpl: harness.documentImpl,
      FileImpl: TestFile
    });

    expect(result.name).toBe('logo-del-nino-final-2.webp');
  });

  it('convierte una fotografía de producto a WebP y limita su lado mayor', async () => {
    const harness = createRasterHarness({ width: 3024, height: 4032 });
    const source = new TestFile(['source'], 'electrolit-fresa.jpg', {
      type: 'image/jpeg',
      lastModified: 456
    });

    const result = await optimizeBrandingImageToWebp({
      file: source,
      purpose: 'product-image',
      createImageBitmapImpl: harness.createImageBitmapImpl,
      documentImpl: harness.documentImpl,
      FileImpl: TestFile
    });

    expect(result.name).toBe('electrolit-fresa.webp');
    expect(result.type).toBe('image/webp');
    expect(result.lastModified).toBe(456);
    expect(harness.canvas.width).toBe(960);
    expect(harness.canvas.height).toBe(1280);
    expect(harness.canvas.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      'image/webp',
      0.8
    );
  });

  it('usa el archivo original cuando el navegador no produce WebP', async () => {
    const harness = createRasterHarness({
      width: 1200,
      height: 630,
      outputType: 'image/png'
    });
    const source = new TestFile(['source'], 'portada.png', { type: 'image/png' });

    const result = await optimizeBrandingImageToWebp({
      file: source,
      purpose: 'business-cover',
      createImageBitmapImpl: harness.createImageBitmapImpl,
      documentImpl: harness.documentImpl,
      FileImpl: TestFile
    });

    expect(result).toBe(source);
    expect(harness.close).toHaveBeenCalledOnce();
  });
});
