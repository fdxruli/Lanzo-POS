// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ store: {}, runtime: null, status: null, listeners: new Set(), actors: new Set(), backup: vi.fn(), initialize: vi.fn(async () => {}) }));
vi.mock('../../../store/useAppStore', () => {
  const useAppStore = (selector) => selector(mocks.store);
  useAppStore.getState = () => mocks.store;
  return { useAppStore };
});
vi.mock('../../../services/BackupRiskEvaluator', () => ({ startBackupRiskEvaluator: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../services/backup/backupManager', () => ({ backupManager: {
  getStatus: () => mocks.status,
  initialize: mocks.initialize,
  subscribe: (listener) => { mocks.listeners.add(listener); listener(mocks.status); return () => mocks.listeners.delete(listener); },
  backup: mocks.backup
} }));
vi.mock('../../../services/auth/actorRuntimeController', () => ({
  ActorRuntimeError: class extends Error {},
  ACTOR_RUNTIME_ERROR_CODES: { PERMISSION_DENIED: 'DENIED', CONTEXT_STALE: 'STALE' },
  actorRuntimeController: {
  getState: () => mocks.runtime,
  subscribe: (listener) => { mocks.actors.add(listener); return () => mocks.actors.delete(listener); },
  capture: () => {
    const saved = mocks.runtime;
    return { actorKey: saved.actorKey, generation: saved.generation, assertCurrent: () => {
      if (mocks.runtime !== saved || saved.status !== 'granted') throw new Error('STALE');
      return saved;
    } };
  }
} }));
import BackupRuntime from '../BackupRuntime';
import { buildLocalBackupAttentionKey, resetLocalBackupAttentionMemory, updateLocalBackupAttention } from '../../../services/backup/localBackupAttention';
import { useLocalBackupAttention } from '../../../hooks/useLocalBackupAttention';

const baseStatus = (patch = {}) => ({ initialized: true, busy: false, configured: false, unlocked: false, supported: true, permission: 'granted', settings: { cronBlocked: false }, ...patch });
function Probe() {
  const attention = useLocalBackupAttention();
  return <output data-testid="attention" data-read={attention.record?.readStates?.includes(attention.condition?.key) ? 'read' : 'unread'}>{attention.ready ? attention.condition?.key : 'unknown'}</output>;
}
function Location() { return <output data-testid="route">{useLocation().pathname}{useLocation().search}</output>; }
const mount = () => render(<MemoryRouter><BackupRuntime /><Probe /><Location /></MemoryRouter>);
const emit = (status) => act(() => { mocks.status = status; mocks.listeners.forEach((listener) => listener(status)); });
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); resetLocalBackupAttentionMemory();
  mocks.runtime = { status: 'granted', actorType: 'admin', actorId: 'admin1', actorKey: 'admin:admin1', sessionId: 'session1', generation: 1, permissions: ['*'], deviceRef: 'device1', tenant: { databaseName: `LanzoDB_t_t_${'a'.repeat(32)}` } };
  mocks.store = { licenseDetails: { features: { cloud_pos_sync: false, local_backup_alerts: true } }, currentDeviceRole: 'admin', currentAdminUser: { id: 'admin1' }, currentStaffUser: null, needsDriveReauth: false, markDriveNeedsReauth: vi.fn() };
  mocks.status = baseStatus();
  mocks.backup.mockResolvedValue({ success: true, skipped: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('BackupRuntime durable attention and headless operation', () => {
  it('presents one compact notice, routes to backup, and never asks for a PIN in the POS', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar respaldos' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/configuracion?tab=backup');
    expect(screen.queryByLabelText('PIN de respaldo')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Más tarde' })).not.toBeInTheDocument();
  });
  it('keeps the decision across remount, cleared session and a new actor runtime generation', async () => {
    const view = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Más tarde' }));
    view.unmount(); sessionStorage.clear(); resetLocalBackupAttentionMemory();
    mocks.runtime = { ...mocks.runtime, generation: 2, sessionId: 'new-session' };
    mocks.status = baseStatus({ configured: true, unlocked: false });
    mount();
    await waitFor(() => expect(screen.getByTestId('attention')).toHaveTextContent('unlock'));
    expect(screen.queryByRole('button', { name: 'Más tarde' })).not.toBeInTheDocument();
  });
  it('does not show an initial notice if the condition was already read in the bell', async () => {
    const key = await buildLocalBackupAttentionKey({ databaseName: mocks.runtime.tenant.databaseName, actorKey: mocks.runtime.actorKey, deviceRef: mocks.runtime.deviceRef });
    updateLocalBackupAttention(key, 'read', 'configure');
    mount();
    await waitFor(() => expect(screen.getByTestId('attention')).toHaveTextContent('configure'));
    expect(screen.queryByRole('button', { name: 'Más tarde' })).not.toBeInTheDocument();
  });
  it('does not mark success or re-present the banner during transient busy/error transitions', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Más tarde' }));
    emit(baseStatus({ busy: true }));
    expect(screen.getByTestId('attention')).toHaveTextContent('configure');
    emit(baseStatus({ configured: true, settings: { cronBlocked: true, lastResult: 'error' } }));
    expect(screen.getByTestId('attention')).toHaveTextContent('error');
    expect(screen.queryByRole('button', { name: 'Más tarde' })).not.toBeInTheDocument();
  });
  it('runs the existing four-hour automatic timer after the banner is dismissed', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Más tarde' }));
    vi.useFakeTimers();
    emit(baseStatus({ configured: true, unlocked: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000); });
    expect(mocks.backup).toHaveBeenCalledWith({ reason: 'idle_4h', manual: false });
    expect(screen.queryByRole('button', { name: 'Más tarde' })).not.toBeInTheDocument();
  });
  it('makes a genuinely new error unread after confirmed recovery without reviving the banner', async () => {
    mocks.status = baseStatus({ configured: true, unlocked: true, settings: { lastResult: 'error', cronBlocked: true } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar respaldos' }));
    expect(screen.getByTestId('attention')).toHaveAttribute('data-read', 'read');
    emit(baseStatus({ configured: true, unlocked: true, settings: { lastResult: 'success', lastBackupAt: '2026-10-17T12:00:00Z' } }));
    await waitFor(() => expect(screen.getByTestId('attention')).toHaveTextContent('ready'));
    emit(baseStatus({ configured: true, unlocked: true, settings: { lastResult: 'error', cronBlocked: true, lastBackupAt: '2026-10-17T12:00:00Z' } }));
    expect(screen.getByTestId('attention')).toHaveTextContent('error');
    expect(screen.getByTestId('attention')).toHaveAttribute('data-read', 'unread');
    expect(screen.queryByRole('button', { name: 'Más tarde' })).not.toBeInTheDocument();
  });
  it('recognizes a recovery followed by a new failure while the actor was away', async () => {
    const key = await buildLocalBackupAttentionKey({ databaseName: mocks.runtime.tenant.databaseName, actorKey: mocks.runtime.actorKey, deviceRef: mocks.runtime.deviceRef });
    updateLocalBackupAttention(key, 'read', 'error', new Date('2026-10-17T10:00:00Z'));
    mocks.status = baseStatus({ configured: true, unlocked: true, settings: { lastResult: 'error', cronBlocked: true, lastBackupAt: '2026-10-17T12:00:00Z' } });
    mount();
    await waitFor(() => expect(screen.getByTestId('attention')).toHaveTextContent('error'));
    await waitFor(() => expect(screen.getByTestId('attention')).toHaveAttribute('data-read', 'unread'));
    expect(screen.queryByRole('button', { name: 'Más tarde' })).not.toBeInTheDocument();
  });
  it('separates a second actor and does not reuse the first actor preference', async () => {
    const view = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Más tarde' }));
    view.unmount();
    mocks.runtime = { ...mocks.runtime, actorId: 'admin2', actorKey: 'admin:admin2', generation: 2 };
    mocks.store.currentAdminUser = { id: 'admin2' };
    mount();
    expect(await screen.findByRole('button', { name: 'Más tarde' })).toBeInTheDocument();
  });
  it('allows Staff with sync permission independently of inventory permission', async () => {
    mocks.runtime = { ...mocks.runtime, actorType: 'staff', actorId: 'staff1', actorKey: 'staff:staff1', permissions: ['sync'] };
    Object.assign(mocks.store, { currentDeviceRole: 'staff', currentStaffUser: { id: 'staff1', permissions: { sync: true, inventory: false, products: false } } });
    mount();
    expect(await screen.findByRole('button', { name: 'Revisar respaldos' })).toBeInTheDocument();
  });
  it('rejects a click captured before the current actor is revoked', async () => {
    mount();
    const review = await screen.findByRole('button', { name: 'Revisar respaldos' });
    mocks.runtime = { ...mocks.runtime, status: 'locked', generation: 2 };
    fireEvent.click(review);
    expect(screen.getByTestId('route')).not.toHaveTextContent('/configuracion');
    expect(JSON.parse(localStorage.getItem(localStorage.key(0))).readStates).toEqual([]);
  });
  it('discards an in-flight preference key when actor authority changes', async () => {
    const pending = [];
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn(() => new Promise((resolve) => pending.push(resolve))) } });
    mount();
    await act(async () => {
      mocks.runtime = { ...mocks.runtime, status: 'locked', generation: 2 };
      mocks.actors.forEach((listener) => listener(mocks.runtime));
      pending.forEach((resolve) => resolve(new Uint8Array(32).buffer));
    });
    expect(screen.getByTestId('attention')).toHaveTextContent('unknown');
    expect(screen.queryByRole('button', { name: 'Más tarde' })).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
  });
  it('rejects a stale click when the app-store identity changes before ActorRuntime', async () => {
    mount();
    const review = await screen.findByRole('button', { name: 'Revisar respaldos' });
    mocks.store.currentAdminUser = { id: 'another-admin' };
    fireEvent.click(review);
    expect(screen.getByTestId('route')).not.toHaveTextContent('/configuracion');
    expect(JSON.parse(localStorage.getItem(localStorage.key(0))).readStates).toEqual([]);
  });
  it('does not initialize the local manager from a cloud bell subscription', async () => {
    mocks.store.licenseDetails.features.cloud_pos_sync = true;
    render(<Probe />);
    await act(async () => {});
    expect(mocks.initialize).not.toHaveBeenCalled();
  });
  it.each(['pro', 'denied', 'mismatch'])('suppresses local attention for %s context', async (mode) => {
    if (mode === 'pro') mocks.store.licenseDetails.features.cloud_pos_sync = true;
    if (mode === 'denied') {
      mocks.runtime = { ...mocks.runtime, actorType: 'staff', actorId: 'staff1', actorKey: 'staff:staff1', permissions: ['inventory'] };
      Object.assign(mocks.store, { currentDeviceRole: 'staff', currentStaffUser: { id: 'staff1', permissions: { inventory: true } } });
    }
    if (mode === 'mismatch') mocks.store.currentAdminUser = { id: 'someone-else' };
    mount();
    await act(async () => {});
    expect(screen.getByTestId('attention')).toHaveTextContent('unknown');
    expect(screen.queryByRole('button', { name: 'Más tarde' })).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
  });
});
