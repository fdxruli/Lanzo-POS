// @vitest-environment jsdom
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { transfer, resolveCode, close, scanner } = vi.hoisted(() => ({
  transfer: vi.fn(),
  resolveCode: vi.fn(),
  close: vi.fn(),
  scanner: vi.fn(),
}));

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: (selector) => selector({ addMultipleScannedProducts: transfer }),
}));
vi.mock('../../../services/barcodeCache', () => ({ resolveWithCacheResult: resolveCode }));
vi.mock('../../../services/audioBeep', () => ({
  playBeep: vi.fn(),
  playErrorBeep: vi.fn(),
}));
vi.mock('../../../services/Logger', () => ({
  default: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock('../../../hooks/scanner/useZxingScanner', () => ({
  isRecoverableDecodeError: vi.fn(() => false),
  useZxingScanner: scanner,
}));
vi.mock('../commercialBarcodeFormats', () => ({
  COMMERCIAL_BARCODE_SCAN_HINTS: new Map(),
}));
vi.mock('../CameraViewport', () => ({
  CameraViewport: () => <div data-testid="camera-preview" />,
}));
vi.mock('../ScannerCartList', () => ({
  ScannerCartList: ({ items }) => (
    <div data-testid="scanned-cart">
      {items.map((item) => <span key={item.uniqueLineId}>{item.name}: {item.quantity};</span>)}
    </div>
  ),
}));

import ScannerModal from '../ScannerModal';

const product = (name) => ({
  id: name,
  name,
  price: 10,
  stock: 100,
  trackStock: false,
  saleType: 'unit',
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

const scanned = async (code) => {
  await act(async () => {
    scanner.mock.lastCall[0].onDecodeResult({ getText: () => code });
    await Promise.resolve();
  });
};

const unlockAfterSuccessfulScan = async () => {
  await act(async () => {
    vi.advanceTimersByTime(500);
    await Promise.resolve();
  });
};

const confirmButton = () => screen.getByRole('button', { name: /Confirmar \(/ });

const readProduct = async (name) => {
  resolveCode.mockResolvedValueOnce({ status: 'RESOLVED', product: product(name) });
  await scanned(name);
  await unlockAfterSuccessfulScan();
};

const confirm = async () => {
  await act(async () => {
    fireEvent.click(confirmButton());
    await Promise.resolve();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  transfer.mockReset();
  resolveCode.mockReset();
  close.mockReset();
  scanner.mockReset().mockReturnValue({
    ref: { current: null },
    torch: { supported: false, enabled: false, pending: false },
    toggleTorch: vi.fn(),
    restartCamera: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('ScannerModal commercial confirmation guards', () => {
  it('shows a duplicate once and never adds it, including on repeated reads', async () => {
    render(<ScannerModal show onClose={close} />);
    resolveCode.mockResolvedValue({
      status: 'DUPLICATE',
      code: '7501400800069',
      matches: [
        { id: 'a', name: 'Bicarbonato De Sodio' },
        { id: 'b', name: 'Bicarbonato Nordin' },
      ],
    });
    await scanned('7501400800069');
    await unlockAfterSuccessfulScan();
    await scanned('7501400800069');
    expect(screen.getByText(/Este código pertenece a varios productos/)).toBeInTheDocument();
    expect(screen.getByText(/Bicarbonato De Sodio, Bicarbonato Nordin/)).toBeInTheDocument();
    expect(document.querySelectorAll('.unknown-badge')).toHaveLength(1);
    expect(screen.getByTestId('scanned-cart')).toBeEmptyDOMElement();
    expect(transfer).not.toHaveBeenCalled();
  });

  it.each([
    ['NOT_FOUND', 'Producto no registrado'],
    ['INACTIVE', 'Producto registrado, pero desactivado'],
    ['NO_SELLABLE_BATCH', 'Producto registrado, sin lote disponible'],
  ])('explains %s without adding a cart item', async (status, message) => {
    render(<ScannerModal show onClose={close} />);
    resolveCode.mockResolvedValue({ status, code: '7501400800069', product: { id: 'a', name: 'Bicarbonato' } });
    await scanned('7501400800069');
    expect(screen.getByText(new RegExp(message))).toBeInTheDocument();
    expect(screen.getByTestId('scanned-cart')).toBeEmptyDOMElement();
    expect(transfer).not.toHaveBeenCalled();
  });

  it('holds A while B resolves; ignores a click before React paints disabled; transfers both once', async () => {
    transfer.mockResolvedValue({ success: true, addedCount: 2, incrementedCount: 0, failedCount: 0 });
    render(<ScannerModal show onClose={close} />);
    await readProduct('A');
    expect(confirmButton()).toBeEnabled();

    const pendingB = deferred();
    resolveCode.mockReturnValueOnce(pendingB.promise);
    const buttonBeforeRendering = confirmButton();
    // Both actions are in the same React batch: the old enabled button can still fire.
    await act(async () => {
      scanner.mock.lastCall[0].onDecodeResult({ getText: () => 'B' });
      buttonBeforeRendering.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(transfer).not.toHaveBeenCalled();
    expect(confirmButton()).toBeDisabled();

    await act(async () => { pendingB.resolve({ status: 'RESOLVED', product: product('B') }); await Promise.resolve(); });
    expect(screen.getByTestId('scanned-cart')).toHaveTextContent('A: 1');
    expect(screen.getByTestId('scanned-cart')).toHaveTextContent('B: 1');
    await unlockAfterSuccessfulScan();
    expect(confirmButton()).toBeEnabled();

    await confirm();
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(transfer.mock.calls[0][0].map((item) => item.name).sort()).toEqual(['A', 'B']);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('preserves prior products if an unresolved lookup returns no product', async () => {
    transfer.mockResolvedValue({ success: true, addedCount: 1, incrementedCount: 0, failedCount: 0 });
    render(<ScannerModal show onClose={close} />);
    await readProduct('A');
    const unknown = deferred();
    resolveCode.mockReturnValueOnce(unknown.promise);
    await scanned('UNKNOWN');
    expect(confirmButton()).toBeDisabled();
    await act(async () => { unknown.resolve({ status: 'NOT_FOUND', code: 'UNKNOWN' }); await Promise.resolve(); });
    await unlockAfterSuccessfulScan();
    expect(screen.getByTestId('scanned-cart')).toHaveTextContent('A: 1');
    await confirm();
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(transfer.mock.calls[0][0]).toHaveLength(1);
  });

  it('releases a failed lookup without adding an invalid item', async () => {
    transfer.mockResolvedValue({ success: true, addedCount: 2, incrementedCount: 0, failedCount: 0 });
    render(<ScannerModal show onClose={close} />);
    await readProduct('A');
    const failed = deferred();
    resolveCode.mockReturnValueOnce(failed.promise);
    await scanned('BAD');
    expect(confirmButton()).toBeDisabled();
    await act(async () => { failed.reject(new Error('Dexie read failed')); await Promise.resolve(); });
    await unlockAfterSuccessfulScan();
    await readProduct('C');
    await confirm();
    expect(transfer.mock.calls[0][0].map((item) => item.name).sort()).toEqual(['A', 'C']);
  });

  it('does not send twice when Confirmar is clicked rapidly', async () => {
    const pending = deferred();
    transfer.mockReturnValue(pending.promise);
    render(<ScannerModal show onClose={close} />);
    await readProduct('A');
    const button = confirmButton();
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Confirmando...' })).toBeDisabled();
    await act(async () => {
      pending.resolve({ success: true, addedCount: 1, incrementedCount: 0, failedCount: 0 });
      await Promise.resolve();
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('unlocks scanning after a verified all-failed transfer, preserving A, B and new C', async () => {
    transfer
      .mockResolvedValueOnce({ success: false, addedCount: 0, incrementedCount: 0, failedCount: 2 })
      .mockResolvedValueOnce({ success: true, addedCount: 3, incrementedCount: 0, failedCount: 0 });
    render(<ScannerModal show onClose={close} />);
    await readProduct('A');
    await readProduct('B');
    await confirm();
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByTestId('scanned-cart')).toHaveTextContent('A: 1');
    expect(screen.getByTestId('scanned-cart')).toHaveTextContent('B: 1');
    expect(confirmButton()).toBeEnabled();

    await readProduct('C');
    expect(screen.getByTestId('scanned-cart')).toHaveTextContent('C: 1');
    await confirm();
    expect(transfer).toHaveBeenCalledTimes(2);
    expect(transfer.mock.calls[1][0].map((item) => item.name).sort()).toEqual(['A', 'B', 'C']);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('blocks further reads and transfers when a rejected write has an unknown outcome', async () => {
    transfer.mockRejectedValueOnce(new Error('unknown POS result'));
    render(<ScannerModal show onClose={close} />);
    await readProduct('A');
    await confirm();
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo verificar');
    expect(confirmButton()).toBeDisabled();
    await scanned('B');
    expect(resolveCode).toHaveBeenCalledTimes(1);
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('scanned-cart')).toHaveTextContent('A: 1');
    expect(screen.getByRole('button', { name: 'Cerrar escaner' })).toBeEnabled();
  });

  it('treats a failure without item counts as uncertain, not a safe retry', async () => {
    transfer.mockResolvedValueOnce({ success: false });
    render(<ScannerModal show onClose={close} />);
    await readProduct('A');
    await confirm();
    expect(screen.getByRole('alert')).toHaveTextContent('revisa el carrito');
    expect(confirmButton()).toBeDisabled();
  });

  it('ignores a transfer result that arrives after the parent unmounts the modal', async () => {
    const pending = deferred();
    transfer.mockReturnValue(pending.promise);
    const view = render(<ScannerModal show onClose={close} />);
    await readProduct('A');
    await confirm();
    view.unmount();
    await act(async () => {
      pending.resolve({ success: true, addedCount: 1, incrementedCount: 0, failedCount: 0 });
      await Promise.resolve();
    });
    expect(close).not.toHaveBeenCalled();
  });
});
