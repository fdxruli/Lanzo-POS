import { describe, expect, it } from 'vitest';
import scannerModalSource from '../ScannerModal.jsx?raw';
import scannerFormatsSource from '../commercialBarcodeFormats.js?raw';
import desktopNoticeCss from '../ScannerDesktopNotice.css?raw';

describe('scanner desktop camera guidance', () => {
  it('loads the desktop guidance with the shared scanner module', () => {
    expect(scannerFormatsSource).toContain("import './ScannerDesktopNotice.css';");
  });

  it('uses the existing desktop breakpoint and stays out of mobile layout', () => {
    expect(desktopNoticeCss).toContain('@media (min-width: 768px)');
    expect(desktopNoticeCss).toContain('.scanner-modal-content .modal-title::after');
    expect(desktopNoticeCss).toContain('Escaneo con cámara en computadora');
    expect(desktopNoticeCss).toContain('dispositivo móvil');
    expect(desktopNoticeCss).toContain('lectores físicos');
  });

  it('does not change scanner lifecycle or pause behavior', () => {
    expect(scannerModalSource).toContain('paused: !show || isConfirming');
    expect(scannerModalSource).not.toContain('desktopNotice');
    expect(scannerModalSource).not.toContain('DesktopScanner');
  });
});
