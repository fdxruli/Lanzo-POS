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

  it('renders inventory and financial findings as readable values instead of JSON', async () => {
    const timestamp = new Date().toISOString();
    const sale = {
      id: 'sale-1',
      timestamp,
      status: 'closed',
      total: 1250,
      paymentMethod: 'card',
      items: [{ id: 'p-1', name: 'Producto', quantity: 10, price: 125, lineTotal: 1250, cost: 80 }]
    };

    render(
      <OperationalDiagnostics
        menu={[{ id: 'p-1', name: 'Producto', trackStock: true, stock: 0, committedStock: 0, minStock: 2, cost: 10 }]}
        sales={[sale]}
        customers={[]}
        wasteLogs={[]}
        reportSource={{ mode: 'cloud' }}
      />
    );

    await waitFor(() => expect(screen.getAllByText('Productos sin stock').length).toBeGreaterThan(0));
    const stockLabel = screen.getByText('Stock actual');
    expect(stockLabel).toBeInTheDocument();
    expect(stockLabel.parentElement).toHaveTextContent('0');
    expect(screen.queryByText(/"id"\s*:/)).not.toBeInTheDocument();
    expect(screen.getByText('Datos mixtos: cloud + información local complementaria')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Diagnóstico financiero/ }));
    await waitFor(() => expect(screen.getAllByText('$1,250.00').length).toBeGreaterThan(0));
    expect(screen.getByText('Margen bruto')).toBeInTheDocument();
    expect(screen.getByText('36.0%')).toBeInTheDocument();
    expect(screen.getByText('Tarjeta')).toBeInTheDocument();
    expect(screen.getAllByText('Productos con mayor contribución').length).toBeGreaterThan(0);
    expect(screen.queryByText(/"paymentMethods"\s*:/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bundefined\b/i);
    expect(document.body.textContent).not.toMatch(/\bnull\b/i);
    expect(document.body.textContent).not.toMatch(/\bNaN\b/i);
    expect(document.body.textContent).not.toContain('[object Object]');
  });

  it('shows customer metrics with human labels and keeps personal details out of the summary', async () => {
    const timestamp = new Date().toISOString();
    render(
      <OperationalDiagnostics
        sales={[{
          id: 'sale-customer-1',
          timestamp,
          status: 'closed',
          total: 350,
          customerId: 'customer-1',
          items: [{ id: 'p-1', name: 'Producto', quantity: 1, lineTotal: 350, cost: 100 }]
        }]}
        customers={[{ id: 'customer-1', name: 'Cliente Confidencial', isActive: true, balance: 125 }]}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: /Diagnóstico de clientes/ }));
    await waitFor(() => expect(screen.getByText('Clientes registrados')).toBeInTheDocument());
    expect(screen.getByText('Ventas anónimas')).toBeInTheDocument();
    expect(screen.getByText('Deuda total')).toBeInTheDocument();
    expect(screen.queryByText('Cliente Confidencial')).not.toBeInTheDocument();
    expect(screen.queryByText(/"customerId"\s*:/)).not.toBeInTheDocument();
  });

  it('groups incomplete inventory data and presents local batch source as neutral information', async () => {
    render(
      <OperationalDiagnostics
        menu={[
          { id: 'p-1', name: 'Sin mínimo', trackStock: true, stock: 3, committedStock: 0, cost: 10 },
          { id: 'p-2', name: 'Completo', trackStock: true, stock: 5, committedStock: 0, minStock: 2, cost: 10 }
        ]}
        reportSource={{ mode: 'cloud' }}
      />
    );

    await waitFor(() => expect(screen.getByText(/Stock mínimo no configurado en 1 producto/)).toBeInTheDocument());
    expect(screen.getByText(/El cálculo de stock bajo no incluye ese producto/)).toBeInTheDocument();
    expect(screen.queryByText(/Datos incompletos:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/no se sustituyeron silenciosamente/i)).not.toBeInTheDocument();

    const localSource = screen.getByText('Fuente de lotes: datos locales de este dispositivo. Puede no incluir cambios realizados desde otros dispositivos.');
    expect(localSource.closest('.opdiag-limitation')).toHaveClass('opdiag-limitation--info');
  });
});
