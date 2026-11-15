// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PublicCheckoutDialog from '../PublicCheckoutDialog';
import { buildAcceptedEcommerceOrderItems } from '../../../../utils/ecommercePriceAcceptance';

const baseCart = {
  items: [{
    product: { id: 'product-1', price: 100 },
    quantity: 1,
    pricingMode: 'standard',
    baseUnitPrice: 100,
    wholesaleBaseUnitPrice: null,
    appliedUnitPrice: 100,
    wholesaleTierRef: null,
    wholesaleMinQuantity: null,
    variantAdjustment: 0,
    optionsAdjustment: 0,
    lineTotal: '100.00'
  }],
  totalUnits: 1,
  subtotal: '100.00',
  currency: 'MXN',
  minimumReached: true,
  isReconciled: true,
};
const baseAcceptedItems = buildAcceptedEcommerceOrderItems(baseCart.items);

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
  acceptedItems: baseAcceptedItems,
  observedItems: baseAcceptedItems,
  requestUncertain: false,
  confirmedOrder: null,
  onClose: vi.fn(),
  onSubmit: vi.fn().mockResolvedValue(undefined),
  onRefreshCart: vi.fn(),
  onAcceptCurrentTotal: vi.fn(),
  onClearPriceAcceptance: vi.fn(),
  onReviewCart: vi.fn(),
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
    expect(screen.getByLabelText('Calle / avenida / camino *')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Nombre *'), 'Cliente QA');
    await user.type(screen.getByLabelText('Teléfono *'), '9610000000');
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }));

    expect(screen.getByText('Escribe la calle, avenida o camino.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits normalized structured delivery data and a compatible formatted address', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderDialog({
      portal: { slug: 'delivery-only', pickupEnabled: false, deliveryEnabled: true },
      onSubmit,
    });

    await user.type(screen.getByLabelText('Nombre *'), 'Cliente QA');
    await user.type(screen.getByLabelText('Teléfono *'), '9610000000');
    await user.type(screen.getByLabelText('Calle / avenida / camino *'), ' Avenida Central ');
    await user.type(screen.getByLabelText('Número exterior'), ' 24 ');
    await user.type(screen.getByLabelText('Número interior'), ' B ');
    await user.type(screen.getByLabelText('Colonia / barrio / ejido / localidad *'), ' Centro ');
    await user.type(screen.getByLabelText('Municipio / ciudad *'), ' Tuxtla Gutiérrez ');
    await user.type(screen.getByLabelText('Estado *'), ' Chiapas ');
    await user.type(screen.getByLabelText('Código postal *'), '29000');
    await user.type(screen.getByLabelText('Referencia para llegar'), ' Frente al parque ');
    await user.type(screen.getByLabelText('Notas'), ' Tocar la puerta ');
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Cliente QA',
      phone: '9610000000',
      address: 'Avenida Central #24 Int. B, Centro, Tuxtla Gutiérrez, Chiapas, CP 29000',
      deliveryAddress: {
        street: 'Avenida Central',
        exteriorNumber: '24',
        interiorNumber: 'B',
        neighborhood: 'Centro',
        municipality: 'Tuxtla Gutiérrez',
        state: 'Chiapas',
        postalCode: '29000',
        reference: 'Frente al parque'
      },
      notes: 'Tocar la puerta',
      fulfillmentMethod: 'delivery'
    });
  });

  it('accepts S/N for rural-compatible delivery addresses', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderDialog({
      portal: { slug: 'delivery-only', pickupEnabled: false, deliveryEnabled: true },
      onSubmit,
    });

    await user.type(screen.getByLabelText('Nombre *'), 'Cliente rural');
    await user.type(screen.getByLabelText('Teléfono *'), '9610000000');
    await user.type(screen.getByLabelText('Calle / avenida / camino *'), 'Camino al ejido');
    await user.type(screen.getByLabelText('Número exterior'), 'S/N');
    await user.type(screen.getByLabelText('Colonia / barrio / ejido / localidad *'), 'Ejido La Esperanza');
    await user.type(screen.getByLabelText('Municipio / ciudad *'), 'Ocosingo');
    await user.type(screen.getByLabelText('Estado *'), 'Chiapas');
    await user.type(screen.getByLabelText('Código postal *'), '29950');
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      address: 'Camino al ejido #S/N, Ejido La Esperanza, Ocosingo, Chiapas, CP 29950',
      deliveryAddress: expect.objectContaining({ exteriorNumber: 'S/N' })
    }));
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

  it('requires a separate acceptance when the checkout total has not been accepted yet', async () => {
    const user = userEvent.setup();
    const view = renderDialog({ acceptedItems: null });

    await user.type(screen.getByLabelText('Nombre *'), 'Cliente QA');
    await user.type(screen.getByLabelText('Teléfono *'), '9610000000');
    expect(screen.getByRole('button', { name: 'Confirmar pedido' })).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: /Acepto el total de/ }));
    expect(view.props.onAcceptCurrentTotal).toHaveBeenCalledTimes(1);
  });

  it('blocks acceptance and checkout when current pricing is invalid', () => {
    const invalidCart = {
      ...baseCart,
      subtotal: '0.00',
      items: [{
        ...baseCart.items[0],
        product: { ...baseCart.items[0].product, pricingValid: false },
        baseUnitPrice: 0,
        appliedUnitPrice: 0,
        lineTotal: '0.00'
      }]
    };
    renderDialog({ cart: invalidCart, acceptedItems: null, observedItems: null });

    expect(screen.getByText('Precio no disponible')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/No se pudo validar el precio/);
    expect(screen.queryByRole('checkbox', { name: /Acepto el total de/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar pedido' })).toBeDisabled();
  });

  it('keeps the same idempotent recovery available when refreshed pricing is invalid', () => {
    const invalidCart = {
      ...baseCart,
      items: [{
        ...baseCart.items[0],
        product: { ...baseCart.items[0].product, pricingValid: false },
        baseUnitPrice: 0,
        appliedUnitPrice: 0,
        lineTotal: '0.00'
      }]
    };
    renderDialog({
      cart: invalidCart,
      acceptedItems: baseAcceptedItems,
      observedItems: baseAcceptedItems,
      requestUncertain: true,
      status: 'recoverable_error'
    });

    expect(screen.getByRole('button', { name: 'Reintentar envío seguro' })).toBeEnabled();
  });

  it('shows the previous and current totals after the catalog changes during checkout', async () => {
    const user = userEvent.setup();
    const originalCart = {
      ...baseCart,
      items: [{
        product: { id: 'product-1' }, quantity: 1, pricingMode: 'standard',
        baseUnitPrice: 100, appliedUnitPrice: 100, variantAdjustment: 0,
        optionsAdjustment: 0, lineTotal: '100.00'
      }]
    };
    const changedCart = {
      ...originalCart,
      subtotal: '120.00',
      items: [{ ...originalCart.items[0], baseUnitPrice: 120, appliedUnitPrice: 120, lineTotal: '120.00' }]
    };
    const acceptedItems = buildAcceptedEcommerceOrderItems(originalCart.items);
    const onAcceptCurrentTotal = vi.fn();
    renderDialog({
      cart: changedCart,
      acceptedItems,
      observedItems: acceptedItems,
      onAcceptCurrentTotal
    });

    expect(screen.getByText('El precio de tu pedido cambió')).toBeInTheDocument();
    expect(screen.getByText('$100.00')).toBeInTheDocument();
    expect(screen.getAllByText('$120.00').length).toBeGreaterThan(0);
    expect(screen.getByText('+$20.00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Aceptar nuevo total y continuar' }));
    expect(onAcceptCurrentTotal).toHaveBeenCalledTimes(1);
  });

  it('blocks a new request until a conflicting idempotency order is checked', () => {
    renderDialog({
      status: 'recoverable_error',
      requestUncertain: true,
      error: Object.assign(new Error('El pedido ya está registrado.'), {
        code: 'ECOMMERCE_IDEMPOTENCY_CONFLICT',
        action: 'check_orders'
      })
    });

    expect(screen.getByText(/Confirma con el negocio si lo recibió antes de intentar otro/))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pedido pendiente de verificación' }))
      .toBeDisabled();
  });

  it('keeps personal data after a recoverable error', async () => {
    const user = userEvent.setup();
    const view = renderDialog();

    await user.type(screen.getByLabelText('Nombre *'), 'Cliente compartido');
    await user.type(screen.getByLabelText('Teléfono *'), '9611112233');
    await user.click(screen.getByRole('radio', { name: /Domicilio/ }));
    await user.type(screen.getByLabelText('Calle / avenida / camino *'), 'Calle de prueba 123');
    await user.type(screen.getByLabelText('Notas'), 'Sin cebolla');

    view.rerenderDialog({
      status: 'recoverable_error',
      error: Object.assign(new Error('Revisa tu conexión.'), { code: 'ECOMMERCE_PUBLIC_NETWORK_ERROR' }),
    });

    expect(screen.getByLabelText('Nombre *')).toHaveValue('Cliente compartido');
    expect(screen.getByLabelText('Teléfono *')).toHaveValue('9611112233');
    expect(screen.getByLabelText('Calle / avenida / camino *')).toHaveValue('Calle de prueba 123');
    expect(screen.getByLabelText('Notas')).toHaveValue('Sin cebolla');
  });

  it('clears the structured address immediately when changing delivery to pickup', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('radio', { name: /Domicilio/ }));
    await user.type(screen.getByLabelText('Calle / avenida / camino *'), 'Dirección temporal');
    await user.click(screen.getByRole('radio', { name: /Recoger/ }));
    expect(screen.queryByLabelText('Calle / avenida / camino *')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Domicilio/ }));
    expect(screen.getByLabelText('Calle / avenida / camino *')).toHaveValue('');
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
    expect(screen.getByLabelText('Calle / avenida / camino *')).toHaveValue('');
  });

  it('clears the form after success while keeping server confirmation intact', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const view = renderDialog({ onContinue });

    await user.type(screen.getByLabelText('Nombre *'), 'Cliente exitoso');
    await user.type(screen.getByLabelText('Teléfono *'), '9619998877');
    await user.click(screen.getByRole('radio', { name: /Domicilio/ }));
    await user.type(screen.getByLabelText('Calle / avenida / camino *'), 'Avenida confirmada 20');
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
