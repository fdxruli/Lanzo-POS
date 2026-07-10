// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PublicCheckoutDialog from '../PublicCheckoutDialog';

const baseCart = {
  items: [{ product: { id: 'product-1' }, quantity: 1 }],
  totalUnits: 1,
  subtotal: '100.00',
  currency: 'MXN',
  minimumReached: true,
  isReconciled: true,
};

const basePortal = {
  pickupEnabled: true,
  deliveryEnabled: true,
};

const renderDialog = (overrides = {}) => render(
  <PublicCheckoutDialog
    isOpen
    status="editing"
    error={null}
    portal={basePortal}
    features={{ whatsappCheckout: true }}
    cart={baseCart}
    confirmedOrder={null}
    onClose={vi.fn()}
    onSubmit={vi.fn().mockResolvedValue(undefined)}
    onRefreshCart={vi.fn()}
    onContinue={vi.fn()}
    {...overrides}
  />
);

afterEach(cleanup);

describe('PublicCheckoutDialog', () => {
  it('preselects pickup and submits a valid pickup without an address', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onSubmit });

    expect(screen.getByRole('radio', { name: /Recoger/ })).toBeChecked();
    await user.type(screen.getByLabelText('Nombre *'), 'Cliente QA');
    await user.type(screen.getByLabelText('Teléfono *'), '9610000000');
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Cliente QA',
      phone: '9610000000',
      address: '',
      notes: '',
      fulfillmentMethod: 'pickup',
    });
  });

  it('preselects delivery when it is the only method and requires an address', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderDialog({
      portal: { pickupEnabled: false, deliveryEnabled: true },
      onSubmit,
    });

    expect(screen.getByRole('radio', { name: /Domicilio/ })).toBeChecked();
    expect(screen.getByLabelText(/Dirección/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Nombre *'), 'Cliente QA');
    await user.type(screen.getByLabelText('Teléfono *'), '9610000000');
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }));

    expect(screen.getByText('Escribe una dirección de al menos 5 caracteres.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('preselects pickup when it is the only method', () => {
    renderDialog({ portal: { pickupEnabled: true, deliveryEnabled: false } });
    expect(screen.getByRole('radio', { name: /Recoger/ })).toBeChecked();
    expect(screen.queryByRole('radio', { name: /Domicilio/ })).not.toBeInTheDocument();
  });

  it('guards two consecutive submits with one active promise', async () => {
    let resolveRequest;
    const activeRequest = new Promise((resolve) => { resolveRequest = resolve; });
    const onSubmit = vi.fn(() => activeRequest);
    renderDialog({ onSubmit });

    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Cliente QA' } });
    fireEvent.change(screen.getByLabelText('Teléfono *'), { target: { value: '9610000000' } });
    const form = screen.getByRole('button', { name: 'Confirmar pedido' }).closest('form');
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    resolveRequest();
    await activeRequest;
  });

  it('disables submission while the parent is submitting', () => {
    renderDialog({ status: 'submitting' });
    expect(screen.getByRole('button', { name: 'Enviando pedido...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cerrar checkout' })).toBeDisabled();
  });

  it('offers cart refresh for stale catalog errors', async () => {
    const user = userEvent.setup();
    const onRefreshCart = vi.fn();
    renderDialog({
      error: Object.assign(new Error('La cantidad cambió.'), { code: 'ECOMMERCE_STOCK_LIMIT_EXCEEDED' }),
      onRefreshCart,
    });

    await user.click(screen.getByRole('button', { name: 'Actualizar carrito' }));
    expect(onRefreshCart).toHaveBeenCalledTimes(1);
  });

  it('shows the server code and total and exposes WhatsApp only with feature and safe URL', () => {
    const confirmedOrder = {
      order: {
        code: 'PED-1001',
        total: 125,
        currency: 'MXN',
        fulfillmentMethod: 'pickup',
        createdAt: '2026-07-10T12:00:00.000Z',
      },
      whatsapp: { url: 'https://wa.me/529610000000?text=Pedido' },
    };
    renderDialog({ status: 'confirmed', confirmedOrder });

    expect(screen.getByRole('heading', { name: 'Pedido enviado' })).toBeInTheDocument();
    expect(screen.getByText('PED-1001')).toBeInTheDocument();
    expect(screen.getByText('$125.00')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Enviar resumen por WhatsApp' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('keeps confirmation when WhatsApp is unavailable', () => {
    renderDialog({
      status: 'confirmed',
      features: { whatsappCheckout: false },
      confirmedOrder: {
        order: {
          code: 'PED-1002',
          total: 100,
          currency: 'MXN',
          fulfillmentMethod: 'delivery',
          createdAt: '2026-07-10T12:00:00.000Z',
        },
        whatsapp: { url: '' },
      },
    });

    expect(screen.getByText('PED-1002')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Enviar resumen por WhatsApp' })).not.toBeInTheDocument();
    expect(screen.getByText(/El pedido ya fue registrado/)).toBeInTheDocument();
  });
});
