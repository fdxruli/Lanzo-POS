import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('physical scanner foundation architecture', () => {
  it('routes POS physical input through the normalized hook, cache resolver, and existing mutation seam', () => {
    const source = read('src/components/pos/PosPageContent.jsx');

    expect(source).toContain("usePhysicalBarcodeScanner");
    expect(source).toContain("resolveWithCache(scanEvent.code)");
    expect(source).toContain("addMultipleScannedProducts?.([product])");
    expect(source).toContain("!ui.activeModal");
    expect(source).toContain("!ui.isMobileCartOpen");
    expect(source).toContain("void playBeep(1000, 'sine')");
  });

  it('keeps ProductFormV2 as capture-only and disables physical input during secondary/camera modals', () => {
    const formSource = read('src/components/products/form-v2/ProductFormV2.jsx');
    const fieldSource = read('src/components/products/form-v2/components/ProductCoreFields.jsx');

    expect(formSource).toContain('usePhysicalBarcodeScanner');
    expect(formSource).toContain("setField('barcode', scanEvent.code)");
    expect(formSource).toContain('!isScannerOpen && !isRecipeModalOpen && !isWholesaleModalOpen');
    expect(fieldSource).toContain('data-scanner-physical-capture="true"');
    expect(formSource).not.toContain('resolveWithCache');
  });

  it('normalizes the ZXing output at ScannerModal boundary without changing the camera hook', () => {
    const modalSource = read('src/components/scanner/ScannerModal.jsx');
    const cameraHookSource = read('src/hooks/scanner/useZxingScanner.js');

    expect(modalSource).toContain("createBarcodeScanEvent({");
    expect(modalSource).toContain("source: 'camera'");
    expect(modalSource).toContain('code: result.getText()');
    expect(modalSource).toContain('onScanSuccess(scanEvent)');
    expect(modalSource).not.toContain('WebHID');
    expect(modalSource).not.toContain('WebUSB');
    expect(cameraHookSource).not.toContain('keyboard-wedge');
  });

  it('does not activate or reuse the legacy 100ms-only implementations', () => {
    const physicalHookSource = read('src/hooks/scanner/usePhysicalBarcodeScanner.js');
    const posSource = read('src/components/pos/PosPageContent.jsx');
    const formSource = read('src/components/products/form-v2/ProductFormV2.jsx');

    expect(physicalHookSource).not.toContain("useBarcodeScanner");
    expect(posSource).not.toContain("from './useBarcodeScanner'");
    expect(formSource).not.toContain("from '../../../hooks/pos/useBarcodeScanner'");
  });
});
