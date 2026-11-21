// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import BatchTable, { formatBatchCalendarDate } from '../BatchTable';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

const props = (product, productBatches, features = { hasExpiry: true }) => ({
  product, features, productBatches, totalStock: 0, inventoryValue: 0,
  isLoadingBatches: false, isLoadingInitial: false, isLoadingNextPage: false, isRefreshing: false,
  loadedCount: productBatches.length, totalCount: productBatches.length, hasMore: false,
  onRefresh: vi.fn(), onLoadMore: vi.fn(), onOpenNew: vi.fn(), onEditBatch: vi.fn(), onDeleteBatch: vi.fn()
});

describe('lot expiry calendar identity', () => {
  it.each([
    ['an ISO timestamp', '2027-12-31T00:00:00Z'],
    ['a calendar date', '2027-12-31']
  ])('formats %s without shifting its calendar day', (_description, expiryDate) => {
    expect(formatBatchCalendarDate(expiryDate)).toBe('31/12/2027');
  });

  it('shows the same expiry date for pharmacy and general products while preserving batch details', () => {
    const createdAt = '2026-11-20T00:30:00.000Z';
    const general = { id: 'soap', name: 'Jabón QA', productType: 'other', price: 45 };
    const medicine = { id: 'medicine', name: 'Medicamento', price: 55,
      metadata: { pharmacy: { kind: 'medicine', status: 'confirmed' } } };
    render(<>
      <BatchTable {...props(general, [{ id: 'soap-batch', stock: 27, createdAt,
        expiryDate: '2027-12-31T00:00:00Z', supplier: 'Proveedor jabón' }])} />
      <BatchTable {...props(medicine, [{ id: 'medicine-batch', stock: 10, createdAt,
        expiryDate: '2027-12-31T00:00:00Z', supplier: 'Proveedor medicamento' }])} />
    </>);

    expect(screen.getAllByText('31/12/2027')).toHaveLength(2);
    expect(screen.getAllByText(`Ingreso del ${new Date(createdAt).toLocaleDateString('es-MX')}`)).toHaveLength(2);
    expect(screen.getByText('27')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('$45.00')).toBeInTheDocument();
    expect(screen.getByText('$55.00')).toBeInTheDocument();
    expect(screen.getByText('Proveedor jabón')).toBeInTheDocument();
    expect(screen.getByText('Proveedor medicamento')).toBeInTheDocument();
  });

  it.each([
    ['a missing date', null],
    ['an invalid date', 'not-a-date'],
    ['an impossible calendar date', '2027-02-30']
  ])('shows a safe fallback for %s', (_description, expiryDate) => {
    const product = { id: 'general', name: 'Producto general', price: 20 };
    render(<BatchTable {...props(product, [{ id: 'general-batch', stock: 1, expiryDate }])} />);

    expect(screen.getByText('Fecha no registrada')).toBeInTheDocument();
  });

  it('shows the manufacturer lot code and clearly marks expired medicine as unavailable for sale', () => {
    const product = { id: 'medicine-vi', name: 'Medicamento VI', expirationMode: 'STRICT', price: 20,
      metadata: { pharmacy: { kind: 'medicine', fraction: 'VI', status: 'confirmed' } } };
    render(<BatchTable {...props(product, [{
      id: 'lot-old', productId: product.id, stock: 0, isActive: true,
      manufacturerBatchId: 'VI-HIST-001', expiryDate: '2000-11-18T00:00:00.000Z'
    }])} />);

    expect(screen.getByText('Lote fabricante VI-HIST-001')).toBeInTheDocument();
    expect(screen.getByText('Vencido · no disponible para venta')).toBeInTheDocument();
    expect(screen.getByText('18/11/2000')).toBeInTheDocument();
  });

  it('communicates an expired archived medicine while keeping its history actions disabled', () => {
    const product = { id: 'medicine-vi', name: 'Medicamento VI', expirationMode: 'STRICT', price: 20,
      metadata: { pharmacy: { kind: 'medicine', fraction: 'VI', status: 'confirmed' } } };
    render(<BatchTable {...props(product, [{
      id: 'lot-expired-archived', productId: product.id, stock: 0, isActive: false,
      status: 'expired', archivedAt: '2026-11-18T00:00:00.000Z',
      manufacturerBatchId: 'VI-HIST-ARCHIVED', expiryDate: '2000-11-18'
    }])} />);

    expect(screen.getByText('Vencido · no disponible para venta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Editar Ingreso del/ })).toBeDisabled();
  });

  it('shows a Cloud snake-case expiry and its current status without product expiry flags', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T12:00:00'));
    const product = { id: 'medicine-cloud', name: 'Medicamento Cloud', price: 20,
      metadata: { pharmacy: { kind: 'medicine', status: 'confirmed' } } };
    render(<BatchTable {...props(product, [{ id: 'lot-future', productId: product.id, stock: 5,
      expiry_date: '2026-12-01', is_active: true }], { hasExpiry: false, hasLots: false })} />);

    expect(screen.getByText('01/12/2026')).toBeInTheDocument();
    expect(screen.getByText('Vigente')).toBeInTheDocument();
  });

  it('marks a near expiry using the existing FEFO warning window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T12:00:00'));
    const product = { id: 'medicine-near', name: 'Medicamento próximo', price: 20,
      metadata: { pharmacy: { kind: 'medicine', status: 'confirmed' } } };
    render(<BatchTable {...props(product, [{ id: 'lot-near', productId: product.id, stock: 5,
      expiryDate: '2026-11-22' }], { hasExpiry: false, hasLots: false })} />);

    expect(screen.getByText('Próximo a vencer · Vence en 3 días')).toBeInTheDocument();
  });

  it('shows a missing-date state and does not add expiry details to a general product', () => {
    const medicine = { id: 'medicine-no-date', name: 'Medicamento sin fecha', price: 20,
      metadata: { pharmacy: { kind: 'medicine', status: 'confirmed' } } };
    const { rerender } = render(<BatchTable {...props(medicine, [{ id: 'lot-missing', stock: 1,
      expiryDate: null }], { hasExpiry: false, hasLots: false })} />);
    expect(screen.getAllByText('Fecha no registrada')).toHaveLength(2);
    expect(screen.getByText('Estado de caducidad')).toBeInTheDocument();

    const general = { id: 'general', name: 'Producto general', price: 20 };
    rerender(<BatchTable {...props(general, [{ id: 'general-lot', stock: 1, expiryDate: '2026-12-01' }],
      { hasExpiry: false, hasLots: false })} />);
    expect(screen.queryByText('Caducidad')).not.toBeInTheDocument();
    expect(screen.queryByText('Estado de caducidad')).not.toBeInTheDocument();
  });

  it.each([360, 390, 1280])('shows the manufacturer identity and empty state at %ipx viewport width', (width) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    const product = { id: 'medicine-vi', name: 'Medicamento VI', expirationMode: 'STRICT', price: 20,
      metadata: { pharmacy: { kind: 'medicine', fraction: 'VI', status: 'confirmed' } } };
    render(<BatchTable {...props(product, [{
      id: 'lot-empty', productId: product.id, stock: 0, isActive: false, status: 'inactive',
      manufacturerBatchId: 'VI-EMPTY-IDENTITY-2026', expiryDate: '2027-10-31'
    }])} />);

    expect(screen.getByText('Lote fabricante VI-EMPTY-IDENTITY-2026')).toBeVisible();
    expect(screen.getByText('Sin existencias')).toBeVisible();
    expect(screen.getByRole('button', { name: /^Editar Ingreso del/ }).disabled).toBe(false);
  });
});
