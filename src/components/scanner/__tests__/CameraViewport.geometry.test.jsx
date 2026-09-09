// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CameraViewport } from '../CameraViewport';
import cameraViewportSource from '../CameraViewport.jsx?raw';

const scannerModalCssSource = readFileSync(
  resolve(process.cwd(), 'src/components/scanner/ScannerModal.css'),
  'utf8',
);

const createRect = (width, height, left = 0, top = 0) => ({
  width,
  height,
  top,
  right: left + width,
  bottom: top + height,
  left,
  x: left,
  y: top,
  toJSON: () => ({}),
});

const setViewportWidth = (width) => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  });
};

const renderViewport = (videoRef, onDecodeRegionChange, viewportWidth = 1024) => {
  setViewportWidth(viewportWidth);

  return render(
  <CameraViewport
    videoRef={videoRef}
    cameraError={null}
    scanFeedback=""
    isScanning
    isConfirming={false}
    onRetryCamera={vi.fn()}
    onDecodeRegionChange={onDecodeRegionChange}
  />
  );
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CameraViewport geometry integration', () => {
  it('starts safely without metadata and aligns the reticle after metadata arrives', async () => {
    let containerSize = { width: 400, height: 800 };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getBoundingClientRect() {
        return this.classList?.contains('scanner-video-viewport')
          ? createRect(containerSize.width, containerSize.height)
          : createRect(0, 0);
      });

    const videoRef = { current: null };
    const view = renderViewport(videoRef);
    const video = view.container.querySelector('#scanner-video');
    const stage = view.container.querySelector('.scanner-video-stage');
    const viewport = view.container.querySelector('.scanner-video-viewport');

    expect(video).toBeTruthy();
    expect(viewport).toHaveAttribute('data-geometry-ready', 'false');
    expect(stage).not.toHaveStyle({ width: '400px', height: '225px' });
    expect(stage.querySelector('.scanner-reticle')).toBeNull();

    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
    });
    fireEvent(video, new Event('loadedmetadata'));

    await waitFor(() => {
      expect(viewport).toHaveAttribute('data-geometry-ready', 'true');
      expect(stage).toHaveStyle({
        width: '400px',
        height: '225px',
        left: '0px',
        top: '287.5px',
      });
    });

    const reticle = stage.querySelector('.scanner-reticle');
    expect(reticle).toBeTruthy();
    expect(reticle.parentElement).toBe(stage);

    containerSize = { width: 800, height: 400 };
    fireEvent(window, new Event('resize'));

    await waitFor(() => {
      expect(stage).toHaveStyle({ height: '400px' });
      expect(parseFloat(stage.style.width)).toBeCloseTo(711.111111);
      expect(parseFloat(stage.style.left)).toBeCloseTo(44.444444);
      expect(parseFloat(stage.style.top)).toBeCloseTo(0);
    });
  });

  it('uses cover on mobile and keeps the stage aligned to the full viewport', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getBoundingClientRect() {
        if (this.classList?.contains('scanner-video-viewport')) {
          return createRect(400, 800);
        }
        if (this.classList?.contains('scanner-video-stage')) {
          return createRect(400, 800);
        }
        if (this.classList?.contains('scanner-reticle')) {
          return createRect(320, 160, 40, 320);
        }
        return createRect(0, 0);
      });

    const regionChanges = vi.fn();
    const videoRef = { current: null };
    const view = renderViewport(videoRef, regionChanges, 400);
    const video = view.container.querySelector('#scanner-video');
    const stage = view.container.querySelector('.scanner-video-stage');
    const viewport = view.container.querySelector('.scanner-video-viewport');

    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
    });
    fireEvent(video, new Event('loadedmetadata'));

    await waitFor(() => {
      expect(viewport).toHaveAttribute('data-camera-fit', 'cover');
      expect(video).toHaveAttribute('data-camera-fit', 'cover');
      expect(video).toHaveStyle({ objectFit: 'cover' });
      expect(stage).toHaveStyle({
        width: '400px',
        height: '800px',
        left: '0px',
        top: '0px',
      });
      expect(stage.querySelector('.scanner-reticle')).toBeTruthy();
    });

    await waitFor(() => {
      const region = regionChanges.mock.lastCall?.[0];
      expect(region).toEqual(expect.any(Object));
      expect(region.x).toBeCloseTo(0.37625);
      expect(region.y).toBeCloseTo(0.39);
      expect(region.width).toBeCloseTo(0.2475);
      expect(region.height).toBeCloseTo(0.22);
    });
  });

  it('keeps the preview and laser geometry non-cropping and local to the stage', () => {
    expect(cameraViewportSource).toContain('getCameraFitMode');
    expect(cameraViewportSource).toContain('objectFit: cameraFitMode');
    expect(cameraViewportSource).toContain('scanner-video-stage');
    expect(scannerModalCssSource).toContain("data-camera-fit='contain'");
    expect(scannerModalCssSource).toContain("data-camera-fit='cover'");
    expect(scannerModalCssSource).toContain('object-fit: cover;');
    expect(scannerModalCssSource).toContain('object-fit: contain;');
    expect(scannerModalCssSource).toContain('top: calc(100% - 2px);');
    expect(scannerModalCssSource).not.toContain('100dvh * 0.3');
    expect(scannerModalCssSource).not.toContain('aspect-ratio: 4 / 3');
  });

  it('keeps contain on desktop and refreshes after a resize', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getBoundingClientRect() {
        if (this.classList?.contains('scanner-video-viewport')) {
          return createRect(800, 400);
        }
        return createRect(0, 0);
      });

    const videoRef = { current: null };
    const view = renderViewport(videoRef, undefined, 1024);
    const video = view.container.querySelector('#scanner-video');
    const viewport = view.container.querySelector('.scanner-video-viewport');

    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
    });
    fireEvent(video, new Event('loadedmetadata'));

    await waitFor(() => {
      expect(viewport).toHaveAttribute('data-camera-fit', 'contain');
      expect(video).toHaveStyle({ objectFit: 'contain' });
      expect(view.container.querySelector('.scanner-video-stage')).toHaveStyle({
        width: '711.1111111111111px',
        height: '400px',
      });
    });
  });

  it('emits a padded normalized decode region from the measured reticle', async () => {
    const regionChanges = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getBoundingClientRect() {
        if (this.classList?.contains('scanner-video-viewport')) {
          return createRect(400, 800);
        }
        if (this.classList?.contains('scanner-video-stage')) {
          return createRect(400, 225, 0, 287.5);
        }
        if (this.classList?.contains('scanner-reticle')) {
          return createRect(320, 56.25, 40, 371.875);
        }
        return createRect(0, 0);
      });

    const videoRef = { current: null };
    const view = renderViewport(videoRef, regionChanges);
    const video = view.container.querySelector('#scanner-video');
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
    });
    fireEvent(video, new Event('loadedmetadata'));

    await waitFor(() => {
      const region = regionChanges.mock.lastCall?.[0];
      expect(region).toEqual(expect.any(Object));
      expect(region.x).toBeCloseTo(0.06);
      expect(region.y).toBeCloseTo(0.3625);
      expect(region.width).toBeCloseTo(0.88);
      expect(region.height).toBeCloseTo(0.275);
    });
  });

  it('emits null while stage or reticle geometry is invalid', async () => {
    const regionChanges = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getBoundingClientRect() {
        if (this.classList?.contains('scanner-video-viewport')) {
          return createRect(400, 800);
        }
        if (this.classList?.contains('scanner-video-stage')) {
          return createRect(400, 225, 0, 287.5);
        }
        return createRect(0, 0);
      });

    const videoRef = { current: null };
    const view = renderViewport(videoRef, regionChanges);
    const video = view.container.querySelector('#scanner-video');
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
    });
    fireEvent(video, new Event('loadedmetadata'));

    await waitFor(() => expect(regionChanges).toHaveBeenLastCalledWith(null));
  });

  it('refreshes the normalized region after a resize/orientation geometry trigger', async () => {
    const regionChanges = vi.fn();
    let reticle = { left: 40, top: 371.875, width: 320, height: 56.25 };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getBoundingClientRect() {
        if (this.classList?.contains('scanner-video-viewport')) {
          return createRect(400, 800);
        }
        if (this.classList?.contains('scanner-video-stage')) {
          return createRect(400, 225, 0, 287.5);
        }
        if (this.classList?.contains('scanner-reticle')) {
          return createRect(reticle.width, reticle.height, reticle.left, reticle.top);
        }
        return createRect(0, 0);
      });

    const videoRef = { current: null };
    const view = renderViewport(videoRef, regionChanges);
    const video = view.container.querySelector('#scanner-video');
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
    });
    fireEvent(video, new Event('loadedmetadata'));
    await waitFor(() => expect(regionChanges).toHaveBeenLastCalledWith(expect.any(Object)));

    reticle = { left: 80, top: 365, width: 240, height: 70 };
    fireEvent(window, new Event('orientationchange'));

    await waitFor(() => {
      const region = regionChanges.mock.lastCall?.[0];
      expect(region).toEqual(expect.any(Object));
      expect(region.x).toBeCloseTo(0.17);
      expect(region.y).toBeCloseTo(0.3288888889);
      expect(region.width).toBeCloseTo(0.66);
      expect(region.height).toBeCloseTo(0.3422222222);
    });
  });

  it('keeps the reticle measured inside the visible stage', async () => {
    const stageRect = createRect(800, 400);
    const reticleRect = createRect(640, 100, 80, 150);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getBoundingClientRect() {
        if (this.classList?.contains('scanner-video-viewport')) return createRect(800, 400);
        if (this.classList?.contains('scanner-video-stage')) return stageRect;
        if (this.classList?.contains('scanner-reticle')) return reticleRect;
        return createRect(0, 0);
      });

    const videoRef = { current: null };
    const view = renderViewport(videoRef);
    const video = view.container.querySelector('#scanner-video');
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 480 },
    });
    fireEvent(video, new Event('loadedmetadata'));

    await waitFor(() => expect(view.container.querySelector('.scanner-reticle')).toBeTruthy());
    expect(reticleRect.left).toBeGreaterThanOrEqual(stageRect.left);
    expect(reticleRect.top).toBeGreaterThanOrEqual(stageRect.top);
    expect(reticleRect.right).toBeLessThanOrEqual(stageRect.right);
    expect(reticleRect.bottom).toBeLessThanOrEqual(stageRect.bottom);
  });
});
