import { describe, expect, it } from 'vitest';
import { getContainedVideoRect } from '../scannerGeometry';

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
