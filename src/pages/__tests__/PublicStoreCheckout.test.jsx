// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PublicStorePage from '../PublicStorePage';
import { getPublicCartStorageKey } from '../../hooks/ecommerce/usePublicCart';
import { EcommercePublicError } from '../../services/ecommerce/ecommercePublicService';

const serviceMocks = vi.hoisted(() => ({
  getPublicPortalBySlug: vi.fn(),
  getPublicCatalog: vi.fn(),
  createPublicOrder: vi.fn(),
}));

vi.mock('../../services/ecommerce/ecommercePublicService', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getPublicPortalBySlug: serviceMocks.getPublicPortalBySlug,
    getPublicCatalog: serviceMocks.getPublicCatalog,
    createPublicOrder: serviceMocks.createPublicOrder,
  };
});

const portalResult = (overrides = {}) => ({
  portal: {
    slug: 'mi-negocio',
    name: 'Mi negocio',
    headline: 'Comida hecha al momento',
    description: 'Descripción pública',
    logoUrl: '',
    coverImageUrl: '',
    address: 'Centro, Chiapas',
    orderingEnabled: true,
    pickupEnabled: true,
    deliveryEnabled: true,
    minOrderTotal: 50,
    maxOrderItems: 30,
    maxItemQuantity: 99,
    ...overrides.portal,
  },
  hours: { weekly: [], exceptions: [] },
  features: {
    stockVisibility: false,
    orderInbox: true,
    whatsappCheckout: true,
    ...overrides.features,
  },
  ...(Object.prototype.hasOwnProperty.call(overrides, 'availability')
    ? { availability: overrides.availability }
    : {}),
});

const catalogResult = {
  items: [{
    id: 'product-1',
    name: 'Alitas BBQ',
    description: 'Cinco piezas',
    categoryName: 'Alitas',
    price: 80,
    currency: 'MXN',
    imageUrl: '',
    isAvailable: true,
    stock: { mode: 'hidden', status: null, quantity: null },
  }],
  pagination: { limit: 100, offset: 0, hasMore: false },
};

const successfulOrder = (idempotent = false, overrides = {}) => ({
  success: true,
  idempotent,
  order: {
    id: 'order-uuid',
    code: 'PED-1001',
    status: 'new',
    total: 80,
    currency: 'MXN',
    fulfillmentMethod: 'pickup',
    createdAt: '2026-07-10T12:00:00.000Z',
    ...overrides.order,
  },
  whatsapp: {
    phone: '529610000000',
    message: 'Pedido',
    url: 'https://wa.me/529610000000?text=Pedido',
    ...overrides.whatsapp,
  },
});

const renderPage = () => render(
  <MemoryRouter initialEntries={['/tienda/mi-negocio']}>
    <Routes>
      <Route path="/tienda/:slug" element={<PublicStorePage />} />
    </Routes>
  </MemoryRouter>
);

const setNavigatorOnline = (online) => {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: online,
  });
};

async function addAndOpenCart(user) {
  await user.click(await screen.findByRole('button', { name: 'Agregar Alitas BBQ' }));
  await user.click(screen.getByRole('button', { name: 'Ver carrito, 1 unidades' }));
}

async function openAndFillCheckout(user) {
  await addAndOpenCart(user);
  await user.click(screen.getByRole('button', { name: 'Continuar pedido' }));
  await user.type(await screen.findByLabelText('Nombre *'), 'Cliente QA');
  await user.type(screen.getByLabelText('Teléfono *'), '9610000000');
}

describe('PublicStorePage checkout integration', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
    setNavigatorOnline(true);
    window.sessionStorage.clear();
    serviceMocks.getPublicPortalBySlug.mockReset().mockResolvedValue(portalResult());
    serviceMocks.getPublicCatalog.mockReset().mockResolvedValue(catalogResult);
    serviceMocks.createPublicOrder.mockReset().mockResolvedValue(successfulOrder());
  });

  afterEach(() => {
    setNavigatorOnline(true);
    cleanup();
  });

  it('blocks checkout when ordering is disabled', async () => {
    serviceMocks.getPublicPortalBySlug.mockResolvedValue(portalResult({
      portal: { orderingEnabled: false },
    }));
    const user = userEvent.setup();
    renderPage();
    await addAndOpenCart(user);

    expect(screen.getByRole('button', { name: 'Continuar pedido' })).toBeDisabled();
    expect(screen.getAllByText('Este negocio no está recibiendo pedidos por ahora.').length).toBeGreaterThan(0);
  });

  it('keeps the catalog and cart readable while business hours are closed', async () => {
    serviceMocks.getPublicPortalBySlug.mockResolvedValue(portalResult({
      availability: {
        acceptingOrders: false,
        code: 'OUTSIDE_BUSINESS_HOURS',
        timezone: 'America/Mexico_City',
        localDate: '2026-07-14',
        nextOpenAt: '2026-07-15T15:00:00.000Z',
        nextChangeAt: '2026-07-15T15:00:00.000Z',
      },
    }));
    const user = userEvent.setup();
    renderPage();
    await addAndOpenCart(user);

    expect(screen.getAllByRole('heading', { name: 'Alitas BBQ' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Continuar pedido' })).toBeDisabled();
    expect(screen.getAllByText('Cerrado').length).toBeGreaterThan(0);
    expect(window.sessionStorage.getItem(getPublicCartStorageKey('mi-negocio'))).not.toBeNull();
  });

  it('keeps the cart while orders are manually paused', async () => {
    serviceMocks.getPublicPortalBySlug.mockResolvedValue(portalResult({
      availability: {
        acceptingOrders: false,
        code: 'ORDERS_PAUSED',
        timezone: 'America/Mexico_City',
        pauseUntil: null,
        nextChangeAt: null,
      },
    }));
    const user = userEvent.setup();
    renderPage();
    await addAndOpenCart(user);

    expect(screen.getByRole('button', { name: 'Continuar pedido' })).toBeDisabled();
    expect(screen.getAllByText('Pedidos pausados').length).toBeGreaterThan(0);
    expect(window.sessionStorage.getItem(getPublicCartStorageKey('mi-negocio'))).not.toBeNull();
  });

  it('blocks checkout when orderInbox is disabled', async () => {
    serviceMocks.getPublicPortalBySlug.mockResolvedValue(portalResult({
      features: { orderInbox: false },
    }));
    const user = userEvent.setup();
    renderPage();
    await addAndOpenCart(user);

    expect(screen.getByRole('button', { name: 'Continuar pedido' })).toBeDisabled();
  });

  it('blocks checkout until the minimum is reached', async () => {
    serviceMocks.getPublicPortalBySlug.mockResolvedValue(portalResult({
      portal: { minOrderTotal: 100 },
    }));
    const user = userEvent.setup();
    renderPage();
    await addAndOpenCart(user);

    expect(screen.getByRole('button', { name: 'Continuar pedido' })).toBeDisabled();
    expect(screen.getByText(/Faltan.*20\.00.*realizar el pedido/)).toBeInTheDocument();
  });

  it('blocks checkout while offline even when a compatible catalog is readable', async () => {
    setNavigatorOnline(false);
    const user = userEvent.setup();
    renderPage();
    await addAndOpenCart(user);

    expect(screen.getByRole('button', { name: 'Continuar pedido' })).toBeDisabled();
    expect(screen.queryByRole('dialog', { name: 'Finalizar pedido' })).not.toBeInTheDocument();
    expect(serviceMocks.createPublicOrder).not.toHaveBeenCalled();
  });

  it('opens checkout for a reconciled valid cart', async () => {
    const user = userEvent.setup();
    renderPage();
    await addAndOpenCart(user);
    await user.click(screen.getByRole('button', { name: 'Continuar pedido' }));

    expect(await screen.findByRole('dialog', { name: 'Finalizar pedido' })).toBeInTheDocument();
    expect(serviceMocks.getPublicPortalBySlug).toHaveBeenCalledTimes(2);
  });

  it('submits once, confirms with server total and clears the cart on success', async () => {
    const user = userEvent.setup();
    renderPage();
    await openAndFillCheckout(user);
    const confirm = screen.getByRole('button', { name: 'Confirmar pedido' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(serviceMocks.createPublicOrder).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('heading', { name: 'Pedido enviado' })).toBeInTheDocument();
    expect(screen.getByText('PED-1001')).toBeInTheDocument();
    expect(screen.getAllByText('$80.00').length).toBeGreaterThan(0);
    await waitFor(() => expect(window.sessionStorage.getItem(getPublicCartStorageKey('mi-negocio'))).toBeNull());
  });

  it('also clears the cart after an idempotent success', async () => {
    serviceMocks.createPublicOrder.mockResolvedValue(successfulOrder(true));
    const user = userEvent.setup();
    renderPage();
    await openAndFillCheckout(user);
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }));

    expect(await screen.findByText('PED-1001')).toBeInTheDocument();
    await waitFor(() => expect(window.sessionStorage.getItem(getPublicCartStorageKey('mi-negocio'))).toBeNull());
  });

  it('keeps form data, cart and idempotency key after a network error', async () => {
    serviceMocks.createPublicOrder
      .mockRejectedValueOnce(new EcommercePublicError(
        'ECOMMERCE_PUBLIC_NETWORK_ERROR',
        'No se pudo confirmar el pedido. Revisa tu conexión e intenta nuevamente.'
      ))
      .mockResolvedValueOnce(successfulOrder());
    const user = userEvent.setup();
    renderPage();
    await openAndFillCheckout(user);
    await user.click(screen.getByRole('radio', { name: /Domicilio/ }));
    await user.type(screen.getByLabelText(/Dirección/), 'Calle de recuperación 10');
    await user.type(screen.getByLabelText('Notas'), 'Conservar estos datos');
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo confirmar el pedido');
    expect(screen.getByLabelText('Nombre *')).toHaveValue('Cliente QA');
    expect(screen.getByLabelText('Teléfono *')).toHaveValue('9610000000');
    expect(screen.getByLabelText(/Dirección/)).toHaveValue('Calle de recuperación 10');
    expect(screen.getByLabelText('Notas')).toHaveValue('Conservar estos datos');
    expect(window.sessionStorage.getItem(getPublicCartStorageKey('mi-negocio'))).not.toBeNull();
    const firstKey = serviceMocks.createPublicOrder.mock.calls[0][1].idempotencyKey;

    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }));
    expect(await screen.findByText('PED-1001')).toBeInTheDocument();
    expect(serviceMocks.createPublicOrder.mock.calls[1][1].idempotencyKey).toBe(firstKey);
  });

  it('preserves customer data and cart after a server-side availability rejection', async () => {
    const closedPortal = portalResult({
      availability: {
        acceptingOrders: false,
        code: 'OUTSIDE_BUSINESS_HOURS',
        timezone: 'America/Mexico_City',
        localDate: '2026-07-15',
        nextOpenAt: '2026-07-16T15:00:00.000Z',
        nextChangeAt: '2026-07-16T15:00:00.000Z',
      },
    });
    serviceMocks.getPublicPortalBySlug
      .mockReset()
      .mockResolvedValueOnce(portalResult())
      .mockResolvedValueOnce(portalResult())
      .mockResolvedValue(closedPortal);
    serviceMocks.createPublicOrder.mockRejectedValue(new EcommercePublicError(
      'ECOMMERCE_STORE_CLOSED',
      'Este negocio está cerrado en este momento.'
    ));
    const user = userEvent.setup();
    renderPage();
    await openAndFillCheckout(user);
    await user.type(screen.getByLabelText('Notas'), 'Conservar después del cierre');
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Este negocio está cerrado');
    await waitFor(() => expect(serviceMocks.getPublicPortalBySlug).toHaveBeenCalledTimes(3));
    expect(screen.getByLabelText('Nombre *')).toHaveValue('Cliente QA');
    expect(screen.getByLabelText('Notas')).toHaveValue('Conservar después del cierre');
    expect(screen.getByRole('button', { name: 'Confirmar pedido' })).toBeDisabled();
    expect(window.sessionStorage.getItem(getPublicCartStorageKey('mi-negocio'))).not.toBeNull();
    expect(screen.queryByRole('link', { name: /WhatsApp/ })).not.toBeInTheDocument();
  });

  it('revalidates availability on focus and when the document becomes visible', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Agregar Alitas BBQ' });
    expect(serviceMocks.getPublicPortalBySlug).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(serviceMocks.getPublicPortalBySlug).toHaveBeenCalledTimes(2));
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(serviceMocks.getPublicPortalBySlug).toHaveBeenCalledTimes(3));
  });

  it('opens a second checkout without personal data after success', async () => {
    serviceMocks.createPublicOrder.mockResolvedValue(successfulOrder(false, {
      order: { fulfillmentMethod: 'delivery' },
    }));
    const user = userEvent.setup();
    renderPage();
    await openAndFillCheckout(user);
    await user.click(screen.getByRole('radio', { name: /Domicilio/ }));
    await user.type(screen.getByLabelText(/Dirección/), 'Avenida primera 25');
    await user.type(screen.getByLabelText('Notas'), 'Pedido anterior');
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }));

    const confirmationDialog = await screen.findByRole('dialog', { name: 'Pedido enviado' });
    expect(within(confirmationDialog).getByText('PED-1001')).toBeInTheDocument();
    expect(within(confirmationDialog).getByText('Entrega a domicilio')).toBeInTheDocument();
    expect(within(confirmationDialog).getByRole('link', { name: 'Enviar resumen por WhatsApp' })).toBeInTheDocument();
    await user.click(within(confirmationDialog).getByRole('button', { name: 'Seguir comprando' }));

    await addAndOpenCart(user);
    await user.click(screen.getByRole('button', { name: 'Continuar pedido' }));

    expect(await screen.findByLabelText('Nombre *')).toHaveValue('');
    expect(screen.getByLabelText('Teléfono *')).toHaveValue('');
    expect(screen.getByLabelText('Notas')).toHaveValue('');
    expect(screen.getByRole('radio', { name: /Recoger/ })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: /Domicilio/ }));
    expect(screen.getByLabelText(/Dirección/)).toHaveValue('');
  });

  it('offers cart refresh for a stale product error without clearing the cart', async () => {
    serviceMocks.createPublicOrder.mockRejectedValue(new EcommercePublicError(
      'ECOMMERCE_PRODUCT_NOT_AVAILABLE',
      'Uno de los productos ya no está disponible.'
    ));
    const user = userEvent.setup();
    renderPage();
    await openAndFillCheckout(user);
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }));

    expect(await screen.findByRole('button', { name: 'Actualizar carrito' })).toBeInTheDocument();
    expect(window.sessionStorage.getItem(getPublicCartStorageKey('mi-negocio'))).not.toBeNull();
  });
});
