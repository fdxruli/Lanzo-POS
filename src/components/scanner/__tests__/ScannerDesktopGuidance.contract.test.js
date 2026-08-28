import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import scannerModalSource from '../ScannerModal.jsx?raw';
import scannerFormatsSource from '../commercialBarcodeFormats.js?raw';

const scannerModalCssSource = readFileSync(
  resolve(process.cwd(), 'src/components/scanner/ScannerModal.css'),
  'utf8',
);
const desktopNoticeCss = readFileSync(
  resolve(process.cwd(), 'src/components/scanner/ScannerDesktopNotice.css'),
  'utf8',
);

describe('scanner desktop camera guidance', () => {
  it('loads the desktop guidance with the shared scanner module', () => {
    expect(scannerFormatsSource).toContain("import './ScannerDesktopNotice.css';");
  });

  it('uses the existing desktop breakpoint and keeps the guidance compact', () => {
    expect(desktopNoticeCss).toContain('@media (min-width: 768px)');
    expect(desktopNoticeCss).toContain('.scanner-modal-content .modal-title::after');
    expect(desktopNoticeCss).toContain('En desktop, la cámara puede ser menos eficiente.');
    expect(desktopNoticeCss).toContain('Para una operación rápida, usa móvil.');
    expect(desktopNoticeCss).toContain('white-space: nowrap;');
    expect(desktopNoticeCss).not.toContain('lectores físicos');
  });

  it('associates the desktop close control with the camera panel', () => {
    expect(scannerModalSource).toMatch(
      /className="scanner-camera-panel">\s*<div className="scanner-camera-controls">[\s\S]*className="scanner-close-btn"[\s\S]*<div className="scanner-video-container">/
    );
    expect(scannerModalCssSource).toContain('.scanner-camera-panel');
    expect(scannerModalCssSource).toContain('.scanner-camera-controls');
    expect(scannerModalCssSource).toContain('position: static;');
    expect(scannerModalCssSource).toContain('position: absolute;');
  });

  it('does not change scanner lifecycle or pause behavior', () => {
    expect(scannerModalSource).toContain('paused: !show || isConfirming');
    expect(scannerModalSource).not.toContain('desktopNotice');
    expect(scannerModalSource).not.toContain('DesktopScanner');
  });
});
