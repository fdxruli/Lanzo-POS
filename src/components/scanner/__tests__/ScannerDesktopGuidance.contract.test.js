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

  it('uses the existing desktop breakpoint and allows the guidance to wrap', () => {
    expect(desktopNoticeCss).toContain('@media (min-width: 768px)');
    expect(desktopNoticeCss).toContain('.scanner-modal-content .modal-title::after');
    expect(desktopNoticeCss).toContain('En desktop, la cámara puede ser menos eficiente.');
    expect(desktopNoticeCss).toContain('Para una operación rápida, usa móvil.');
    expect(desktopNoticeCss).toContain('max-width: 100%;');
    expect(desktopNoticeCss).toContain('overflow-wrap: break-word;');
    expect(desktopNoticeCss).toContain('white-space: normal;');
    expect(desktopNoticeCss).not.toContain('white-space: nowrap;');
    expect(desktopNoticeCss).not.toContain('lectores físicos');
  });

  it('keeps one functional close control anchored to the modal on desktop and the camera area on mobile', () => {
    expect(scannerModalSource.match(/className="scanner-close-btn"/g)).toHaveLength(1);
    expect(scannerModalSource).toContain('onClick={handleClose}');
    expect(scannerModalSource).toMatch(
      /<h2 className="modal-title">[\s\S]*<\/h2>\s*<button[\s\S]*className="scanner-close-btn"[\s\S]*<\/button>\s*<div className="scanner-main-container">/
    );
    expect(scannerModalSource).not.toMatch(
      /className="scanner-camera-controls">[\s\S]*className="scanner-close-btn"/
    );
    expect(scannerModalCssSource).toContain('position: relative;');
    expect(scannerModalCssSource).toContain('.scanner-camera-panel');
    expect(scannerModalCssSource).toContain('.scanner-camera-controls');
    expect(scannerModalCssSource).toContain('top: max(var(--spacing-sm, 8px), var(--safe-area-top));');
    expect(scannerModalCssSource).toContain('right: max(var(--spacing-sm, 8px), var(--safe-area-right));');

    const desktopCloseRule = scannerModalCssSource.match(
      /@media \(min-width: 768px\) \{[\s\S]*?\.scanner-close-btn\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(desktopCloseRule).toContain('top: var(--ui-space-md');
    expect(desktopCloseRule).toContain('right: var(--ui-space-md');
    expect(desktopCloseRule).toContain('width: 40px;');
    expect(desktopCloseRule).toContain('height: 40px;');
  });

  it('does not change scanner lifecycle or pause behavior', () => {
    expect(scannerModalSource).toContain('paused: !show || isConfirming');
    expect(scannerModalSource).not.toContain('desktopNotice');
    expect(scannerModalSource).not.toContain('DesktopScanner');
  });
});
