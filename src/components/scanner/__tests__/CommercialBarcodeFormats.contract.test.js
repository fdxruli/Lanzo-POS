import { describe, expect, it } from 'vitest';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import scannerModalSource from '../ScannerModal.jsx?raw';
import cameraViewportSource from '../CameraViewport.jsx?raw';
import {
  COMMERCIAL_BARCODE_FORMATS,
  COMMERCIAL_BARCODE_SCAN_HINTS,
} from '../commercialBarcodeFormats';

const scannerModalCssSource = readFileSync(
  resolve(process.cwd(), 'src/components/scanner/ScannerModal.css'),
  'utf8',
);

const EXPECTED_COMMERCIAL_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
  BarcodeFormat.RSS_14,
];

const getReticleBlocks = (source) => (
  [...source.matchAll(/\.scanner-reticle\s*\{([^}]*)\}/g)]
    .map((match) => match[1])
);

const getPercentage = (block, property) => {
  const match = block.match(new RegExp(`${property}\\s*:\\s*(\\d+)%`));
  return Number(match?.[1]);
};

describe('commercial barcode scanner V2.3 contract', () => {
  it('uses exactly the bounded commercial 1D format set', () => {
    expect(COMMERCIAL_BARCODE_FORMATS).toEqual(EXPECTED_COMMERCIAL_FORMATS);
    expect(new Set(COMMERCIAL_BARCODE_FORMATS).size).toBe(8);
    expect(COMMERCIAL_BARCODE_SCAN_HINTS.get(DecodeHintType.POSSIBLE_FORMATS))
      .toBe(COMMERCIAL_BARCODE_FORMATS);
  });

  it('does not enable QR, deferred 2D formats, RSS Expanded, or all-format decoding', () => {
    expect(COMMERCIAL_BARCODE_FORMATS).not.toContain(BarcodeFormat.QR_CODE);
    expect(COMMERCIAL_BARCODE_FORMATS).not.toContain(BarcodeFormat.DATA_MATRIX);
    expect(COMMERCIAL_BARCODE_FORMATS).not.toContain(BarcodeFormat.AZTEC);
    expect(COMMERCIAL_BARCODE_FORMATS).not.toContain(BarcodeFormat.PDF_417);
    expect(COMMERCIAL_BARCODE_FORMATS).not.toContain(BarcodeFormat.RSS_EXPANDED);
    expect(scannerModalSource).toContain('COMMERCIAL_BARCODE_SCAN_HINTS');
    expect(scannerModalSource).not.toContain('BarcodeFormat.QR_CODE');
    expect(scannerModalSource).not.toContain('TRY_HARDER');
    expect(scannerModalSource).not.toContain('POSSIBLE_FORMATS');
  });

  it('keeps the reticle wide and shallow across responsive variants', () => {
    const reticleBlocks = getReticleBlocks(scannerModalCssSource);

    expect(reticleBlocks).toHaveLength(3);
    reticleBlocks.forEach((block) => {
      expect(getPercentage(block, 'width')).toBeGreaterThanOrEqual(75);
      expect(getPercentage(block, 'width')).toBeLessThanOrEqual(85);
      expect(getPercentage(block, 'height')).toBeGreaterThanOrEqual(20);
      expect(getPercentage(block, 'height')).toBeLessThanOrEqual(30);
    });
    expect(cameraViewportSource).toContain('Centra el código de barras');
  });
});
