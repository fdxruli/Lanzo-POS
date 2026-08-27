import { describe, expect, it } from 'vitest';
import {
  expandNormalizedRoi,
  getContainedVideoRect,
  mapNormalizedRegionToSource,
  normalizeChildRectWithinStage,
} from '../scannerGeometry';

const expectContained = (rect, containerWidth, containerHeight) => {
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(containerWidth);
  expect(rect.y + rect.height).toBeLessThanOrEqual(containerHeight);
  expect(rect.isFallback).toBe(false);
};

describe('scanner contained preview geometry', () => {
  it('fits a landscape source inside a portrait viewport without cropping', () => {
    const rect = getContainedVideoRect({
      containerWidth: 400,
      containerHeight: 800,
      videoWidth: 1920,
      videoHeight: 1080,
    });

    expect(rect).toMatchObject({
      width: 400,
      height: 225,
      x: 0,
      y: 287.5,
    });
    expectContained(rect, 400, 800);
  });

  it('fits a landscape source inside a landscape viewport without distortion', () => {
    const rect = getContainedVideoRect({
      containerWidth: 1000,
      containerHeight: 600,
      videoWidth: 1920,
      videoHeight: 1080,
    });

    expect(rect.width / rect.height).toBeCloseTo(1920 / 1080);
    expect(rect.width).toBeCloseTo(1000);
    expect(rect.height).toBeCloseTo(562.5);
    expect(rect.y).toBeCloseTo(18.75);
    expectContained(rect, 1000, 600);
  });

  it('uses native 4:3 dimensions instead of assuming 16:9', () => {
    const rect = getContainedVideoRect({
      containerWidth: 1000,
      containerHeight: 600,
      videoWidth: 640,
      videoHeight: 480,
    });

    expect(rect).toMatchObject({
      width: 800,
      height: 600,
      x: 100,
      y: 0,
    });
    expectContained(rect, 1000, 600);
  });

  it('contains a portrait source inside a landscape viewport', () => {
    const rect = getContainedVideoRect({
      containerWidth: 800,
      containerHeight: 600,
      videoWidth: 1080,
      videoHeight: 1920,
    });

    expect(rect.width).toBeCloseTo(337.5);
    expect(rect.height).toBeCloseTo(600);
    expect(rect.x).toBeCloseTo(231.25);
    expect(rect.y).toBeCloseTo(0);
    expectContained(rect, 800, 600);
  });

  it('fills the container when source and viewport aspect ratios are equal', () => {
    const rect = getContainedVideoRect({
      containerWidth: 800,
      containerHeight: 450,
      videoWidth: 1600,
      videoHeight: 900,
    });

    expect(rect).toMatchObject({
      width: 800,
      height: 450,
      x: 0,
      y: 0,
      isFallback: false,
    });
  });

  it('returns a safe fallback until native metadata is available', () => {
    const rect = getContainedVideoRect({
      containerWidth: 400,
      containerHeight: 800,
      videoWidth: 0,
      videoHeight: 0,
    });

    expect(rect).toEqual({
      width: 400,
      height: 800,
      x: 0,
      y: 0,
      isFallback: true,
    });
  });

  it('recomputes the visible rectangle when the container is resized', () => {
    const portraitRect = getContainedVideoRect({
      containerWidth: 400,
      containerHeight: 800,
      videoWidth: 1920,
      videoHeight: 1080,
    });
    const landscapeRect = getContainedVideoRect({
      containerWidth: 800,
      containerHeight: 400,
      videoWidth: 1920,
      videoHeight: 1080,
    });

    expect(portraitRect.height).toBe(225);
    expect(landscapeRect.width).toBeCloseTo(711.111111);
    expect(landscapeRect.height).toBeCloseTo(400);
    expect(landscapeRect.x).toBeCloseTo(44.444444);
    expectContained(landscapeRect, 800, 400);
  });
});

describe('scanner decode ROI geometry', () => {
  it('maps a normalized reticle region to intrinsic source pixels', () => {
    const region = normalizeChildRectWithinStage({
      stageRect: { left: 0, top: 0, width: 1000, height: 500 },
      childRect: { left: 100, top: 125, width: 800, height: 125 },
    });
    const paddedRegion = expandNormalizedRoi(region);

    expect(region).toEqual({ x: 0.1, y: 0.25, width: 0.8, height: 0.25 });
    expect(mapNormalizedRegionToSource(paddedRegion, 1920, 1080)).toEqual({
      x: 115,
      y: 256,
      width: 1690,
      height: 298,
    });
  });

  it('pads by 5% of measured reticle dimensions per side', () => {
    expect(expandNormalizedRoi({
      x: 0.1,
      y: 0.2,
      width: 0.4,
      height: 0.2,
    })).toMatchObject({
      x: expect.closeTo(0.08),
      y: expect.closeTo(0.19),
      width: expect.closeTo(0.44),
      height: expect.closeTo(0.22),
    });
  });

  it('clamps padded ROI at all source-frame edges', () => {
    const padded = expandNormalizedRoi({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });

    expect(padded).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(mapNormalizedRegionToSource(padded, 640, 480)).toEqual({
      x: 0,
      y: 0,
      width: 640,
      height: 480,
    });
  });

  it('returns null for invalid or zero geometry', () => {
    expect(normalizeChildRectWithinStage({
      stageRect: { left: 0, top: 0, width: 0, height: 500 },
      childRect: { left: 0, top: 0, width: 10, height: 10 },
    })).toBeNull();
    expect(expandNormalizedRoi(null)).toBeNull();
    expect(mapNormalizedRegionToSource(null, 640, 480)).toBeNull();
  });

  it('maps a 16:9 source contained in a portrait stage without cropping', () => {
    const stage = getContainedVideoRect({
      containerWidth: 400,
      containerHeight: 800,
      videoWidth: 1920,
      videoHeight: 1080,
    });

    expect(stage).toMatchObject({ width: 400, height: 225, x: 0, y: 287.5 });
    expect(mapNormalizedRegionToSource({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    }, 1920, 1080)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('maps a 4:3 source contained in a wide stage using native dimensions', () => {
    const stage = getContainedVideoRect({
      containerWidth: 1000,
      containerHeight: 600,
      videoWidth: 640,
      videoHeight: 480,
    });

    expect(stage).toMatchObject({ width: 800, height: 600, x: 100, y: 0 });
    expect(mapNormalizedRegionToSource({
      x: 0.25,
      y: 0.25,
      width: 0.5,
      height: 0.5,
    }, 640, 480)).toEqual({ x: 160, y: 120, width: 320, height: 240 });
  });

  it('handles a square-ish viewport with a bounded normalized region', () => {
    const normalized = normalizeChildRectWithinStage({
      stageRect: { left: 50, top: 50, width: 600, height: 600 },
      childRect: { left: 200, top: 250, width: 300, height: 100 },
    });

    expect(normalized).toEqual({
      x: 0.25,
      y: 1 / 3,
      width: 0.5,
      height: 1 / 6,
    });
    expect(Object.values(normalized).every((value) => value >= 0 && value <= 1)).toBe(true);
  });

  it('remaps the same reticle after orientation or viewport resize', () => {
    const portrait = getContainedVideoRect({
      containerWidth: 400,
      containerHeight: 800,
      videoWidth: 1920,
      videoHeight: 1080,
    });
    const landscape = getContainedVideoRect({
      containerWidth: 800,
      containerHeight: 400,
      videoWidth: 1920,
      videoHeight: 1080,
    });

    expect(portrait.x).not.toBe(landscape.x);
    expect(portrait.height).not.toBe(landscape.height);
    expect(mapNormalizedRegionToSource({
      x: 0.1,
      y: 0.375,
      width: 0.8,
      height: 0.25,
    }, 1920, 1080)).toEqual({ x: 192, y: 405, width: 1536, height: 270 });
  });
});
