// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({
    companyProfile: { business_type: 'abarrotes', timezone: 'America/Mexico_City' }
  })
}));

vi.mock('../../services/diagnostics/diagnosticLocalRepository', () => ({
  diagnosticLocalRepository: {
    getInventorySupplements: vi.fn().mockResolvedValue({ batches: [], inventoryEvents: [] })
  }
}));

import OperationalDiagnostics from './OperationalDiagnostics';

describe('OperationalDiagnostics', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('renders the three deterministic modules and keeps AI actions out of the section', async () => {
    render(
      <OperationalDiagnostics
        menu={[{ id: 'p-1', name: 'Producto', trackStock: true, stock: 0, committedStock: 0, minStock: 2, cost: 10 }]}
        sales={[]}
        customers={[]}
        wasteLogs={[]}
      />
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Diagnóstico operativo' })).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: /Diagnóstico de inventario/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Diagnóstico financiero/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Diagnóstico de clientes/ })).toBeInTheDocument();
    expect(screen.getByText('Historial IA anterior')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generar análisis con IA/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Activar agente IA/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Diagnóstico financiero/ }));
    expect(screen.getByText('Ventas netas')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Periodo'), { target: { value: 'thisMonth' } });
    expect(screen.getByLabelText('Periodo')).toHaveValue('thisMonth');
  });
});
