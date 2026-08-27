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

const createRect = (width, height) => ({
  width,
  height,
  top: 0,
  right: width,
  bottom: height,
  left: 0,
  x: 0,
  y: 0,
  toJSON: () => ({}),
});

const renderViewport = (videoRef) => render(
  <CameraViewport
    videoRef={videoRef}
    cameraError={null}
    scanFeedback=""
    isScanning
    isConfirming={false}
    onRetryCamera={vi.fn()}
  />
);

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

  it('keeps the preview and laser geometry non-cropping and local to the stage', () => {
    expect(cameraViewportSource).toContain("objectFit: 'contain'");
    expect(cameraViewportSource).toContain('scanner-video-stage');
    expect(scannerModalCssSource).toContain('object-fit: contain;');
    expect(scannerModalCssSource).toContain('top: calc(100% - 2px);');
    expect(scannerModalCssSource).not.toContain('object-fit: cover');
    expect(scannerModalCssSource).not.toContain('100dvh * 0.3');
    expect(scannerModalCssSource).not.toContain('aspect-ratio: 4 / 3');
  });
});
