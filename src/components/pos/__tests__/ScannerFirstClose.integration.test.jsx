// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  scanner: vi.fn(),
  resolveCode: vi.fn(),
  transfer: vi.fn(),
  commit: null,
}));

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: (selector) => selector({ addMultipleScannedProducts: mocks.transfer }),
}));
vi.mock('../../../services/barcodeCache', () => ({
  resolveWithCacheResult: mocks.resolveCode,
}));
vi.mock('../../../services/audioBeep', () => ({
  playBeep: vi.fn(), playErrorBeep: vi.fn(),
}));
vi.mock('../../../services/Logger', () => ({
  default: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock('../../../hooks/scanner/useZxingScanner', () => ({
  isRecoverableDecodeError: vi.fn(() => false),
  useZxingScanner: mocks.scanner,
}));
vi.mock('../../scanner/commercialBarcodeFormats', () => ({
  COMMERCIAL_BARCODE_SCAN_HINTS: new Map(),
}));
vi.mock('../../scanner/CameraViewport', () => ({
  CameraViewport: () => <div data-testid="camera-preview" />,
}));
vi.mock('../../scanner/ScannerCartList', () => ({
  ScannerCartList: () => null,
}));
vi.mock('../../scanner/UnknownCodesBanner', () => ({
  UnknownCodesBanner: () => null,
}));
vi.mock('../TablesView', () => ({ default: () => null }));
vi.mock('../SplitBillModal', () => ({ default: () => null }));
vi.mock('../PrescriptionModal', () => ({ default: () => null }));
vi.mock('../LayawayModal', () => ({ default: () => null }));
vi.mock('../../common/PaymentModal', () => ({ default: () => null }));
vi.mock('../../common/QuickCajaModal', () => ({ default: () => null }));

import PosModals from '../PosModals';
import PosFloatingBar from '../PosFloatingBar';
import { usePosModals } from '../../../hooks/pos/usePosModals';

const HISTORY_KEY = '__lanzoDismissibleLayer';

const installHistoryModel = () => {
  const nativeReplace = window.history.replaceState.bind(window.history);
  const entries = [
    { state: { route: 'previous' }, url: '/previous' },
    { state: { route: 'pos' }, url: '/pos' },
  ];
  let index = 1;
  nativeReplace(entries[index].state, document.title, entries[index].url);
  const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation((state, title, url) => {
    entries[index] = { state, url: new URL(url || window.location.href, window.location.origin).pathname };
    nativeReplace(state, title, entries[index].url);
  });
  const pushState = vi.spyOn(window.history, 'pushState').mockImplementation((state, title, url) => {
    entries.splice(index + 1);
    const pathname = new URL(url || window.location.href, window.location.origin).pathname;
    entries.push({ state, url: pathname });
    index += 1;
    nativeReplace(state, title, pathname);
  });
  const back = vi.spyOn(window.history, 'back').mockImplementation(() => {
    if (index <= 0) return;
    index -= 1;
    nativeReplace(entries[index].state, document.title, entries[index].url);
    window.dispatchEvent(new PopStateEvent('popstate', { state: entries[index].state }));
  });
  return { entries, back, pushState, replaceState, get index() { return index; } };
};

const noop = () => {};
const handlers = {
  handleProcessOrder: noop,
  handlePaymentModalClose: noop,
  handleConfirmSplitBill: noop,
  handleQuickCajaSubmit: noop,
  handleQuickCajaClose: noop,
  handlePrescriptionConfirm: noop,
  handleConfirmLayaway: noop,
  handleLoadOpenOrder: noop,
  handleQuickTableAction: noop,
  fetchActiveTablesCount: noop,
  handleAnnulKitchenRejectedOrder: noop,
};

function PosHarness({ initiallyOccupied = false }) {
  const { activeModal, openModal, closeModal } = usePosModals();
  const [cart, setCart] = useState(initiallyOccupied ? [{ id: 'prior' }] : []);

  mocks.commit = (items) => {
    setCart((previous) => [...previous, ...items]);
    return { success: true, addedCount: items.length, incrementedCount: 0, failedCount: 0 };
  };

  return (
    <>
      <button type="button" onClick={() => openModal('scanner')}>Abrir escáner</button>
      <output data-testid="active-modal">{activeModal || 'none'}</output>
      <output data-testid="pos-items">{cart.length}</output>
      <PosFloatingBar
        hasTables={false}
        activeTablesCount={0}
        totalItemsCount={cart.length}
        total={cart.length * 10}
        onOpenTables={noop}
        onOpenCart={noop}
      />
      <PosModals
        activeModal={activeModal}
        onClose={closeModal}
        handlers={handlers}
        data={{
          features: { hasTables: false },
          order: cart, total: cart.length * 10, saleDiscount: 0,
          customer: null, prescriptionItems: [], cajaActual: null,
          aperturaPendiente: null, cashActor: null, isCloudCashReadOnly: false,
          activeOrderId: 'order-1', tableName: '',
        }}
      />
    </>
  );
}

const scan = async (code) => {
  await act(async () => {
    mocks.scanner.mock.lastCall[0].onDecodeResult({ getText: () => code });
    await Promise.resolve();
  });
  await act(async () => {
    vi.advanceTimersByTime(500);
    await Promise.resolve();
  });
};

const confirm = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Confirmar \(/ }));
    await Promise.resolve();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.transfer.mockReset().mockImplementation((items) => mocks.commit(items));
  mocks.resolveCode.mockReset().mockImplementation(async (code) => ({
    status: 'RESOLVED',
    product: { id: code, name: code, price: 10, stock: 100, trackStock: false, saleType: 'unit' },
  }));
  mocks.scanner.mockReset().mockReturnValue({
    ref: { current: null },
    torch: { supported: false, enabled: false, pending: false },
    toggleTorch: noop, restartCamera: noop,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState({}, document.title, '/');
});

describe('POS scanner first confirmation and history', () => {
  it.each([false, true])('transfers once and fully closes, starting occupied=%s', async (initiallyOccupied) => {
    const history = installHistoryModel();
    render(<StrictMode><PosHarness initiallyOccupied={initiallyOccupied} /></StrictMode>);

    const initialCount = initiallyOccupied ? 1 : 0;
    expect(screen.getByTestId('pos-items')).toHaveTextContent(String(initialCount));
    if (!initiallyOccupied) expect(document.querySelector('.floating-pos-bar')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir escáner' }));
    expect(window.history.state[HISTORY_KEY]).toContain('pos-scanner');
    await scan('A');
    await scan('B');
    await confirm();

    expect(mocks.transfer).toHaveBeenCalledTimes(1);
    expect(mocks.transfer.mock.calls[0][0]).toHaveLength(2);
    expect(screen.getByTestId('pos-items')).toHaveTextContent(String(initialCount + 2));
    expect(screen.getByTestId('active-modal')).toHaveTextContent('none');
    expect(document.querySelector('#scanner-modal')).toBeNull();
    expect(document.querySelector('.floating-pos-bar')).not.toBeNull();
    expect(window.location.pathname).toBe('/pos');
    expect(window.history.state).not.toHaveProperty(HISTORY_KEY);
    expect(history.index).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Abrir escáner' }));
    await scan('C');
    await confirm();

    expect(mocks.transfer).toHaveBeenCalledTimes(2);
    expect(mocks.transfer.mock.calls[1][0]).toHaveLength(1);
    expect(screen.getByTestId('pos-items')).toHaveTextContent(String(initialCount + 3));
    expect(screen.getByTestId('active-modal')).toHaveTextContent('none');
    expect(document.querySelector('#scanner-modal')).toBeNull();
    expect(history.pushState).toHaveBeenCalledTimes(2);
    expect(history.back).toHaveBeenCalledTimes(2);
    expect(history.index).toBe(1);
    expect(window.location.pathname).toBe('/pos');
  });

  it('closes with Android Back semantics before confirming, without transferring', () => {
    const history = installHistoryModel();
    render(<StrictMode><PosHarness /></StrictMode>);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir escáner' }));
    act(() => window.history.back());
    expect(screen.getByTestId('active-modal')).toHaveTextContent('none');
    expect(document.querySelector('#scanner-modal')).toBeNull();
    expect(mocks.transfer).not.toHaveBeenCalled();
    expect(history.index).toBe(1);
  });
});
