import { describe, expect, it } from 'vitest';
import posModalsSource from '../../pos/PosModals.jsx?raw';
import productFormSource from '../../products/form-v2/ProductFormV2.jsx?raw';
import scannerModalSource from '../ScannerModal.jsx?raw';

describe('shared scanner engine contract', () => {
  it('keeps POS and ProductFormV2 on the same ScannerModal and camera hook', () => {
    expect(posModalsSource).toContain("import ScannerModal from '../scanner/ScannerModal';");
    expect(productFormSource).toContain("import ScannerModal from '../../scanner/ScannerModal';");
    expect(scannerModalSource).toContain("import { useZxingScanner } from '../../hooks/scanner/useZxingScanner';");
    expect(scannerModalSource).toContain('<ScannerModal');
  });
});

