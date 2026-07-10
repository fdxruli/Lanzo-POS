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
  slug: 'negocio-a',
  pickupEnabled: true,
  deliveryEnabled: true,
};

const baseProps = (overrides = {}) => ({
  isOpen: true,
  status: 'editing',
  error: null,
  portal: basePortal,
  features: { whatsappCheckout: true },
  cart: baseCart,
  confirmedOrder: null,
  onClose: vi.fn(),
  onSubmit: vi.fn().mockResolvedValue(undefined),
  onRefreshCart: vi.fn(),
  onContinue: vi.fn(),
  ...overrides,
});

const renderDialog = (overrides = {}) => {
  const props = baseProps(overrides);
  const view = render(<PublicCheckoutDialog {...props} />);
  return {
    ...view,
    props,
    rerenderDialog(nextOverrides = {}) {
      const nextProps = { ...props, ...nextOverrides };
      view.rerender(<PublicCheckoutDialog {...nextProps} />);
      return nextProps;
    },
  };
};

const confirmedOrder = {
  order: {
    code: 'PED-1001',
    total: 125,
    currency: 'MXN',
    fulfillmentMethod: 'delivery',
    createdAt: '2026-07-10T12:00:00.000Z',
  },
  whatsapp: { url: 'https://wa.me/529610000000?text=Pedido' },
};

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
      portal: { slug: 'delivery-only', pickupEnabled: false, deliveryEnabled: true },
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
    renderDialog({ portal: { slug: 'pickup-only', pickupEnabled: true, deliveryEnabled: false } });
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
    screen.getAllByRole('button', { name: 'Cerrar checkout' })
      .forEach((button) => expect(button).toBeDisabled());
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

  it('keeps personal data after a recoverable error', async () => {
    const user = userEvent.setup();
    const view = renderDialog();

    await user.type(screen.getByLabelText('Nombre *'), 'Cliente compartido');
    await user.type(screen.getByLabelText('Teléfono *'), '9611112233');
    await user.click(screen.getByRole('radio', { name: /Domicilio/ }));
    await user.type(screen.getByLabelText(/Dirección/), 'Calle de prueba 123');
    await user.type(screen.getByLabelText('Notas'), 'Sin cebolla');

    view.rerenderDialog({
      status: 'recoverable_error',
      error: Object.assign(new Error('Revisa tu conexión.'), { code: 'ECOMMERCE_PUBLIC_NETWORK_ERROR' }),
    });

    expect(screen.getByLabelText('Nombre *')).toHaveValue('Cliente compartido');
    expect(screen.getByLabelText('Teléfono *')).toHaveValue('9611112233');
    expect(screen.getByLabelText(/Dirección/)).toHaveValue('Calle de prueba 123');
    expect(screen.getByLabelText('Notas')).toHaveValue('Sin cebolla');
  });

  it('clears the address immediately when changing delivery to pickup', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('radio', { name: /Domicilio/ }));
    await user.type(screen.getByLabelText(/Dirección/), 'Dirección temporal');
    await user.click(screen.getByRole('radio', { name: /Recoger/ }));
    expect(screen.queryByLabelText(/Dirección/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Domicilio/ }));
    expect(screen.getByLabelText(/Dirección/)).toHaveValue('');
  });

  it('clears personal data and recalculates the method when the portal changes', async () => {
    const user = userEvent.setup();
    const view = renderDialog({
      portal: { slug: 'negocio-a', pickupEnabled: true, deliveryEnabled: false },
    });

    await user.type(screen.getByLabelText('Nombre *'), 'Cliente A');
    await user.type(screen.getByLabelText('Teléfono *'), '9612223344');
    await user.type(screen.getByLabelText('Notas'), 'Datos privados');

    view.rerenderDialog({
      portal: { slug: 'negocio-b', pickupEnabled: false, deliveryEnabled: true },
    });

    expect(screen.getByLabelText('Nombre *')).toHaveValue('');
    expect(screen.getByLabelText('Teléfono *')).toHaveValue('');
    expect(screen.getByLabelText('Notas')).toHaveValue('');
    expect(screen.getByRole('radio', { name: /Domicilio/ })).toBeChecked();
    expect(screen.getByLabelText(/Dirección/)).toHaveValue('');
  });

  it('clears the form after success while keeping server confirmation intact', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const view = renderDialog({ onContinue });

    await user.type(screen.getByLabelText('Nombre *'), 'Cliente exitoso');
    await user.type(screen.getByLabelText('Teléfono *'), '9619998877');
    await user.click(screen.getByRole('radio', { name: /Domicilio/ }));
    await user.type(screen.getByLabelText(/Dirección/), 'Avenida confirmada 20');
    await user.type(screen.getByLabelText('Notas'), 'Tocar puerta');

    view.rerenderDialog({ status: 'confirmed', confirmedOrder });

    expect(screen.getByRole('heading', { name: 'Pedido enviado' })).toBeInTheDocument();
    expect(screen.getByText('PED-1001')).toBeInTheDocument();
    expect(screen.getByText('$125.00')).toBeInTheDocument();
    expect(screen.getByText('Entrega a domicilio')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Enviar resumen por WhatsApp' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Seguir comprando' }));
    expect(onContinue).toHaveBeenCalledTimes(1);

    view.rerenderDialog({ status: 'editing', confirmedOrder: null });
    expect(screen.getByLabelText('Nombre *')).toHaveValue('');
    expect(screen.getByLabelText('Teléfono *')).toHaveValue('');
    expect(screen.getByLabelText('Notas')).toHaveValue('');
    expect(screen.getByRole('radio', { name: /Recoger/ })).toBeChecked();
  });

  it('shows the server code and total and exposes WhatsApp only with feature and safe URL', () => {
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
