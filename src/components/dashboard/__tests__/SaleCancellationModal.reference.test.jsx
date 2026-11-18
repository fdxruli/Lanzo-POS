// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SaleCancellationModal from '../SaleCancellationModal';

vi.mock('../../../services/salesCloud/salesCloudCancellationService', () => ({
  salesCloudCancellationService: { previewCloudSaleCancellation: vi.fn() }
}));

describe('SaleCancellationModal sale references', () => {
  afterEach(() => cleanup());

  const props = (sale) => ({
    show: true,
    sale: { items: [], ...sale },
    actorHandle: { assertCurrent: vi.fn() },
    allowWaste: false,
    isSubmitting: false,
    onClose: vi.fn(),
    onConfirm: vi.fn()
  });

  it('shows the operational folio and uses a neutral fallback without one', () => {
    const { rerender } = render(<SaleCancellationModal {...props({
      id: 'sale-internal-uuid', folio: 'V-000048', posFolio: 'FG-01-000048'
    })} />);
    expect(screen.getByRole('heading', { name: 'Cancelar venta FG-01-000048' })).toBeInTheDocument();

    rerender(<SaleCancellationModal {...props({ id: 'sale-internal-uuid' })} />);
    expect(screen.getByRole('heading', { name: 'Cancelar venta sin folio' })).toBeInTheDocument();
    expect(screen.queryByText('sale-internal-uuid')).not.toBeInTheDocument();
  });
});
