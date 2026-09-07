// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  mode: {
    cloudEnabled: true,
    online: true,
    readOnly: false,
    stateKnown: false,
    networkUnavailable: false,
    licenseKey: 'license-test',
    actor: { actorKey: 'admin:one', isStaff: false, responsibleName: 'Admin' }
  },
  getCurrent: vi.fn(),
  invalidateReadGenerations: vi.fn(),
  open: vi.fn(),
  movement: vi.fn(),
  message: vi.fn()
}));

const DEVICE_UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const DEVICE_UUID_B = '650e8400-e29b-41d4-a716-446655440001';
const STATION_A = `cash_station_device_${DEVICE_UUID_A}`;
const STATION_B = `cash_station_device_${DEVICE_UUID_B}`;

vi.mock('../../services/cash/cashRepository', () => ({
  cashRepository: {
    getMode: () => runtime.mode,
    getCurrentCashSession: (...args) => runtime.getCurrent(...args),
    invalidateCashReadGenerations: (...args) => runtime.invalidateReadGenerations(...args),
    openCashSession: (...args) => runtime.open(...args),
    registerMovement: (...args) => runtime.movement(...args),
    adjustInitialFund: vi.fn(),
    closeCashSession: vi.fn(),
    adminCloseCashSession: vi.fn(),
    adoptLegacyCashSession: vi.fn(),
    listCashSessionsForAudit: vi.fn(),
    getCashSessionDetailForAudit: vi.fn()
  }
}));
vi.mock('../../services/utils', () => ({
  showConfirmModal: vi.fn(),
  showMessageModal: (...args) => runtime.message(...args)
}));
vi.mock('../../services/Logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), log: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../../services/cajaService', () => ({
  MOVIMIENTO_TIPOS: {
    ENTRADA: 'entrada',
    SALIDA: 'salida',
    AJUSTE_ENTRADA: 'ajuste_entrada',
    AJUSTE_SALIDA: 'ajuste_salida'
  },
  CAJA_CONFIG: { MAX_CASH_THRESHOLD: 50000 }
}));
vi.mock('../../services/cash/cashStation', () => ({
  isCanonicalCashStation: (value) => Boolean(value && !String(value).startsWith('local:device:')),
  isLocalStationKey: (value) => Boolean(value && String(value).startsWith('local:device:')),
  areCashStationsEquivalent: (left, right) => Boolean(left && right && left === right)
}));
vi.mock('../../services/cashOpeningPolicyService.js', () => ({
  CASH_OPENING_POLICY: { AUTOMATIC: 'automatic', MANUAL: 'manual' },
  CASH_OPENING_POLICY_EVENT: 'cash-opening-policy-changed',
  buildAutomaticOpeningData: vi.fn(),
  buildManualOpeningData: vi.fn(),
  getCashOpeningPolicy: vi.fn(() => 'manual'),
  setCashOpeningPolicy: vi.fn()
}));
vi.mock('../../store/useAppStore', () => {
  const store = (selector) => selector({});
  store.getState = () => ({});
  return { useAppStore: store };
});

import { useCaja } from '../useCaja';

const cachedSession = {
  id: 'cash-known',
  estado: 'abierta',
  actorKey: 'admin:one',
  cashStationId: STATION_A,
  fecha_apertura: '2026-09-06T09:00:00.000Z',
  monto_inicial: '100',
  entradas_efectivo: '0',
  salidas_efectivo: '0'
};

const networkResult = () => ({
  success: true,
  readOnly: true,
  stateKnown: false,
  networkUnavailable: true,
  financialStatus: 'BLOCKED',
  financialCode: 'CASH_NETWORK_UNAVAILABLE',
  cashSession: cachedSession,
  cashSessions: [cachedSession],
  movements: [],
  totals: { ventasContado: '0', abonosFiado: '0' },
  cashStationId: STATION_A,
  actor: runtime.mode.actor,
  mode: runtime.mode
});

const validResult = () => ({
  success: true,
  readOnly: false,
  stateKnown: true,
  networkUnavailable: false,
  financialStatus: 'OWN_SESSION_OPEN',
  cashSession: cachedSession,
  cashSessions: [cachedSession],
  movements: [],
  totals: { ventasContado: '0', abonosFiado: '0' },
  cashStationId: STATION_A,
  actor: runtime.mode.actor,
  mode: { ...runtime.mode, stateKnown: true }
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  runtime.mode.online = true;
  runtime.mode.readOnly = false;
  runtime.mode.stateKnown = false;
  runtime.mode.networkUnavailable = false;
  runtime.getCurrent.mockReset();
  runtime.invalidateReadGenerations.mockReset();
  runtime.open.mockReset();
  runtime.movement.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useCaja network recovery', () => {
  it('keeps the known local session visible but read-only, then unlocks only after forced verification', async () => {
    runtime.getCurrent
      .mockResolvedValueOnce(networkResult())
      .mockResolvedValueOnce(validResult());
    const { result } = renderHook(() => useCaja());

    await waitFor(() => expect(result.current.networkUnavailable).toBe(true));
    expect(result.current.isCloudCashReadOnly).toBe(true);
    expect(result.current.stateKnown).toBe(false);
    expect(result.current.cajaActual).toMatchObject({ id: cachedSession.id });

    await act(async () => {
      await result.current.reintentarVerificacion();
    });

    await waitFor(() => expect(result.current.stateKnown).toBe(true));
    expect(result.current.networkUnavailable).toBe(false);
    expect(result.current.isCloudCashReadOnly).toBe(false);
    expect(runtime.getCurrent).toHaveBeenNthCalledWith(2, { force: true });
  });

  it('revalidates and unlocks after the browser comes back online', async () => {
    runtime.getCurrent
      .mockResolvedValueOnce(networkResult())
      .mockResolvedValueOnce(validResult());
    const { result } = renderHook(() => useCaja());

    await waitFor(() => expect(result.current.networkUnavailable).toBe(true));

    await act(async () => {
      runtime.mode.online = true;
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.isCloudCashReadOnly).toBe(false));
    expect(result.current.stateKnown).toBe(true);
    expect(runtime.getCurrent).toHaveBeenNthCalledWith(2, { force: true });
  });

  it('turns a thrown Failed to fetch into a protected state without an error page', async () => {
    runtime.getCurrent.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useCaja());

    await waitFor(() => expect(result.current.networkUnavailable).toBe(true));
    expect(result.current.error).toBeNull();
    expect(result.current.isCloudCashReadOnly).toBe(true);
    expect(result.current.estadoCaja).toBe('financial_blocked');
  });

  it('keeps CASH_NETWORK_UNAVAILABLE after a manual retry also fails at transport', async () => {
    runtime.getCurrent
      .mockResolvedValueOnce(networkResult())
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useCaja());

    await waitFor(() => expect(result.current.networkUnavailable).toBe(true));
    await act(async () => {
      await result.current.reintentarVerificacion();
    });

    await waitFor(() => expect(result.current.networkUnavailable).toBe(true));
    expect(result.current.stateKnown).toBe(false);
    expect(result.current.isCloudCashReadOnly).toBe(true);
  });

  it('pauses the 30-second polling while disconnected', async () => {
    vi.useFakeTimers();
    runtime.getCurrent.mockResolvedValue(networkResult());
    const { result } = renderHook(() => useCaja());
    await flush();

    expect(result.current.networkUnavailable).toBe(true);
    expect(runtime.getCurrent).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(120000);
      await Promise.resolve();
    });
    expect(runtime.getCurrent).toHaveBeenCalledTimes(1);
  });

  it('ignores a response that started before the browser went offline', async () => {
    let resolveCurrent;
    runtime.getCurrent.mockImplementation(() => new Promise((resolve) => {
      resolveCurrent = resolve;
    }));
    const { result } = renderHook(() => useCaja());
    await waitFor(() => expect(runtime.getCurrent).toHaveBeenCalledTimes(1));

    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.networkUnavailable).toBe(true);

    await act(async () => {
      resolveCurrent(validResult());
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.networkUnavailable).toBe(true);
    expect(result.current.isCloudCashReadOnly).toBe(true);
  });

  it('starts a new forced verification while an older verification is still in flight', async () => {
    let resolveOld;
    runtime.getCurrent.mockImplementation(({ force }) => {
      if (force) return Promise.resolve(validResult());
      return new Promise((resolve) => {
        resolveOld = resolve;
      });
    });
    const { result } = renderHook(() => useCaja());
    await waitFor(() => expect(runtime.getCurrent).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.reintentarVerificacion();
    });
    await waitFor(() => expect(result.current.stateKnown).toBe(true));
    expect(runtime.getCurrent).toHaveBeenNthCalledWith(2, { force: true });

    await act(async () => {
      resolveOld(networkResult());
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.stateKnown).toBe(true);
    expect(result.current.networkUnavailable).toBe(false);
  });

  it('does not send a financial write while state is unknown', async () => {
    runtime.getCurrent.mockResolvedValue(networkResult());
    const { result } = renderHook(() => useCaja());
    await waitFor(() => expect(result.current.networkUnavailable).toBe(true));

    await act(async () => {
      await result.current.registrarMovimiento('entrada', '10', 'test');
      await result.current.abrirCaja({ montoInicial: '10' });
    });

    expect(runtime.movement).not.toHaveBeenCalled();
    expect(runtime.open).not.toHaveBeenCalled();
  });

  it.each([
    ['another station', { cashStationId: STATION_B }],
    ['another actor', { actorKey: 'admin:other' }]
  ])('keeps a verified-looking session blocked when identity belongs to %s', async (_label, overrides) => {
    runtime.getCurrent.mockResolvedValue({
      ...validResult(),
      cashSession: { ...cachedSession, ...overrides },
      stateKnown: true,
      mode: { ...runtime.mode, stateKnown: true }
    });
    const { result } = renderHook(() => useCaja());
    await waitFor(() => expect(result.current.estadoCaja).toBe('financial_blocked'));

    expect(result.current.isCloudCashReadOnly).toBe(true);
    await act(async () => {
      await result.current.registrarMovimiento('entrada', '10', 'test');
    });
    expect(runtime.movement).not.toHaveBeenCalled();
  });

  it('does not create a session across repeated recovery loads', async () => {
    runtime.getCurrent.mockResolvedValue(networkResult());
    for (let index = 0; index < 5; index += 1) {
      const view = renderHook(() => useCaja());
      await waitFor(() => expect(view.result.current.networkUnavailable).toBe(true));
      view.unmount();
    }

    expect(runtime.open).not.toHaveBeenCalled();
    expect(runtime.movement).not.toHaveBeenCalled();
  });
});
