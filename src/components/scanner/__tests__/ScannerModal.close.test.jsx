// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const {
  mockClose,
  mockClearCart,
  mockSetIsConfirming,
  mockUseScannerCart,
  mockUseZxingScanner,
} = vi.hoisted(() => ({
  mockClose: vi.fn(),
  mockClearCart: vi.fn(),
  mockSetIsConfirming: vi.fn(),
  mockUseScannerCart: vi.fn(),
  mockUseZxingScanner: vi.fn(),
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
  useZxingScanner: mockUseZxingScanner,
}));

vi.mock('../CameraViewport', () => ({
  CameraViewport: ({ cameraError, onRetryCamera }) => cameraError ? (
    <div>
      <p role="alert">{cameraError}</p>
      <button type="button" onClick={onRetryCamera}>Reintentar</button>
    </div>
  ) : <div data-testid="camera-viewport" />,
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
  mockUseZxingScanner.mockReturnValue({
    ref: { current: null },
    torch: { supported: false, enabled: false, pending: false },
    toggleTorch: vi.fn(),
    restartCamera: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ScannerModal close control', () => {
  it('renders one accessible button that closes the visible modal', () => {
    render(<ScannerModal show onClose={mockClose} />);

    const closeButtons = screen.getAllByRole('button', { name: 'Cerrar escaner' });
    const closeButton = closeButtons[0];

    expect(closeButtons).toHaveLength(1);
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

  it('hides the torch control if the active camera does not support it', () => {
    render(<ScannerModal show onClose={mockClose} />);
    expect(screen.queryByRole('button', { name: 'Encender linterna' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cerrar escaner' })).toBeEnabled();
  });

  it('offers the torch control when the camera supports it', () => {
    const toggleTorch = vi.fn();
    mockUseZxingScanner.mockReturnValue({
      ref: { current: null },
      torch: { supported: true, enabled: false, pending: false },
      toggleTorch,
    });
    render(<ScannerModal show onClose={mockClose} />);

    const torchButton = screen.getByRole('button', { name: 'Encender linterna' });
    expect(torchButton).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(torchButton);
    expect(toggleTorch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Cerrar escaner' })).toBeEnabled();
  });

  it('disables the torch control during an in-flight change', () => {
    mockUseZxingScanner.mockReturnValue({
      ref: { current: null },
      torch: { supported: true, enabled: false, pending: true },
      toggleTorch: vi.fn(),
    });
    render(<ScannerModal show onClose={mockClose} />);
    expect(screen.getByRole('button', { name: 'Cambiando linterna' })).toBeDisabled();
  });

  it('shows fatal decoder errors and really restarts without clearing scanned items', () => {
    const restartCamera = vi.fn();
    mockUseZxingScanner.mockReturnValue({
      ref: { current: null },
      torch: { supported: false, enabled: false, pending: false },
      toggleTorch: vi.fn(),
      restartCamera,
    });
    render(<ScannerModal show onClose={mockClose} />);
    mockClearCart.mockClear();

    act(() => {
      mockUseZxingScanner.mock.lastCall[0].onError(new Error('unexpected decoder crash'));
    });
    expect(screen.getByRole('alert').textContent).toContain('El escáner se detuvo.');
    expect(screen.queryByTestId('camera-viewport')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(restartCamera).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('camera-viewport')).not.toBeNull();
    expect(mockClearCart).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('offers a retry after camera permission is denied', () => {
    const restartCamera = vi.fn();
    mockUseZxingScanner.mockReturnValue({
      ref: { current: null },
      torch: { supported: false, enabled: false, pending: false },
      toggleTorch: vi.fn(),
      restartCamera,
    });
    render(<ScannerModal show onClose={mockClose} />);
    act(() => {
      const denied = Object.assign(new Error('permission denied'), { name: 'NotAllowedError' });
      mockUseZxingScanner.mock.lastCall[0].onError(denied);
    });

    expect(screen.getByRole('alert').textContent).toContain('Permiso de cámara denegado.');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(restartCamera).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
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
