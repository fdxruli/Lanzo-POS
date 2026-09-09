// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const {
  mockClose,
  mockClearCart,
  mockSetIsConfirming,
  mockUseScannerCart,
} = vi.hoisted(() => ({
  mockClose: vi.fn(),
  mockClearCart: vi.fn(),
  mockSetIsConfirming: vi.fn(),
  mockUseScannerCart: vi.fn(),
}));

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: vi.fn(() => vi.fn()),
}));

vi.mock('../../../services/barcodeCache', () => ({
  resolveWithCache: vi.fn(),
}));

vi.mock('../../../services/audioBeep', () => ({
  playBeep: vi.fn(),
  playErrorBeep: vi.fn(),
}));

vi.mock('../../../services/Logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../../hooks/scanner/useScannerCart', () => ({
  useScannerCart: mockUseScannerCart,
}));

vi.mock('../../../hooks/scanner/useZxingScanner', () => ({
  isRecoverableDecodeError: vi.fn(() => false),
  useZxingScanner: vi.fn(() => ({ ref: { current: null } })),
}));

vi.mock('../CameraViewport', () => ({
  CameraViewport: () => <div data-testid="camera-viewport" />,
}));

vi.mock('../ScannerCartList', () => ({
  ScannerCartList: () => null,
}));

vi.mock('../UnknownCodesBanner', () => ({
  UnknownCodesBanner: () => null,
}));

vi.mock('../commercialBarcodeFormats', () => ({
  COMMERCIAL_BARCODE_SCAN_HINTS: new Map(),
}));

import ScannerModal from '../ScannerModal';

const scannerModalCssSource = readFileSync(
  resolve(process.cwd(), 'src/components/scanner/ScannerModal.css'),
  'utf8',
);

const defaultCart = {
  items: [],
  unknownCodes: [],
  total: 0,
  itemCount: 0,
  isConfirming: false,
  setIsConfirming: mockSetIsConfirming,
  addItem: vi.fn(),
  addQuantity: vi.fn(),
  removeQuantity: vi.fn(),
  addUnknownCode: vi.fn(),
  clearUnknownCodes: vi.fn(),
  clearCart: mockClearCart,
};

beforeEach(() => {
  mockClose.mockReset();
  mockClearCart.mockReset();
  mockSetIsConfirming.mockReset();
  mockUseScannerCart.mockReturnValue(defaultCart);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ScannerModal mobile close control', () => {
  it('renders an accessible button that closes the visible modal', () => {
    render(<ScannerModal show onClose={mockClose} />);

    const closeButton = screen.getByRole('button', { name: 'Cerrar escaner' });

    expect(closeButton).toHaveAttribute('type', 'button');
    expect(closeButton).toHaveAttribute('aria-label', 'Cerrar escaner');
    expect(closeButton).toHaveClass('scanner-close-btn');

    fireEvent.click(closeButton);

    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the close button disabled while confirming', () => {
    mockUseScannerCart.mockReturnValue({
      ...defaultCart,
      isConfirming: true,
    });

    render(<ScannerModal show onClose={mockClose} />);

    const closeButton = screen.getByRole('button', { name: 'Cerrar escaner' });

    expect(closeButton).toBeDisabled();
    fireEvent.click(closeButton);
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('keeps only the close control interactive over the passive camera layers', () => {
    const closeRule = scannerModalCssSource.match(
      /\.scanner-close-btn\s*\{([\s\S]*?)\}/,
    )?.[1];
    const viewportRule = scannerModalCssSource.match(
      /\.scanner-video-viewport\s*\{([\s\S]*?)\}/,
    )?.[1];
    const controlsRule = scannerModalCssSource.match(
      /\.scanner-camera-controls\s*\{([\s\S]*?)\}/,
    )?.[1];

    expect(closeRule).toContain('pointer-events: auto;');
    expect(closeRule).toContain('touch-action: manipulation;');
    expect(viewportRule).toContain('pointer-events: none;');
    expect(controlsRule).toContain('pointer-events: none;');
  });
});
