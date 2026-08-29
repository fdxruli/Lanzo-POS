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

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const dispatchPersistedPageShow = () => {
  const event = new Event('pageshow');
  Object.defineProperty(event, 'persisted', { value: true });
  fireEvent(window, event);
};

const setVisibilityState = (value) => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value
  });
  fireEvent(document, new Event('visibilitychange'));
};

async function addAndOpenCart(user) {
  await user.click(await screen.findByRole('button', { name: 'Agregar Alitas BBQ' }));
  await user.click(screen.getByRole('button', {
    name: 'Ver carrito, 1 unidades, subtotal $80.00'
  }));
}

async function openAndFillCheckout(user) {
  await addAndOpenCart(user);
  await user.click(screen.getByRole('button', { name: 'Continuar pedido' }));
  await user.type(await screen.findByLabelText('Nombre *'), 'Cliente QA');
  await user.type(screen.getByLabelText('Teléfono *'), '9610000000');
}

async function fillDeliveryAddress(user, {
  street = 'Calle de prueba 10',
  reference = 'Frente al parque'
} = {}) {
  await user.type(screen.getByLabelText('Calle / avenida / camino *'), street);
  await user.type(screen.getByLabelText('Número exterior'), '10');
  await user.type(screen.getByLabelText('Colonia / barrio / ejido / localidad *'), 'Centro');
  await user.type(screen.getByLabelText('Municipio / ciudad *'), 'Tuxtla Gutiérrez');
  await user.type(screen.getByLabelText('Estado *'), 'Chiapas');
  await user.type(screen.getByLabelText('Código postal *'), '29000');
  await user.type(screen.getByLabelText('Referencia para llegar'), reference);
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
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    });
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

  it('keeps a submitting checkout visible through BFCache recovery and shows confirmation', async () => {
    const pendingOrder = deferred();
    serviceMocks.createPublicOrder.mockReturnValue(pendingOrder.promise);
    const user = userEvent.setup();
    renderPage();
    await openAndFillCheckout(user);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar pedido' }));
    await waitFor(() => expect(serviceMocks.createPublicOrder).toHaveBeenCalledOnce());

    dispatchPersistedPageShow();
    expect(screen.getByRole('dialog', { name: 'Finalizar pedido' })).toBeInTheDocument();
    expect(screen.getByText('Enviando pedido...')).toBeInTheDocument();

    pendingOrder.resolve(successfulOrder());
    expect(await screen.findByRole('heading', { name: 'Pedido enviado' })).toBeInTheDocument();
    expect(screen.getByText('PED-1001')).toBeInTheDocument();
    const cartKey = getPublicCartStorageKey('mi-negocio');
    await waitFor(() => expect(window.sessionStorage.getItem(cartKey)).toBeNull());
    expect(serviceMocks.createPublicOrder).toHaveBeenCalledOnce();
  });

  it('keeps a submitting checkout visible after a suspension longer than 30 seconds', async () => {
    const pendingOrder = deferred();
    serviceMocks.createPublicOrder.mockReturnValue(pendingOrder.promise);
    let currentTime = 1_000;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => currentTime);
    const user = userEvent.setup();
    renderPage();
    await openAndFillCheckout(user);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar pedido' }));
    await waitFor(() => expect(serviceMocks.createPublicOrder).toHaveBeenCalledOnce());

    setVisibilityState('hidden');
    currentTime = 32_000;
    setVisibilityState('visible');

    expect(screen.getByRole('dialog', { name: 'Finalizar pedido' })).toBeInTheDocument();
    pendingOrder.resolve(successfulOrder());
    expect(await screen.findByRole('heading', { name: 'Pedido enviado' })).toBeInTheDocument();
    expect(serviceMocks.createPublicOrder).toHaveBeenCalledOnce();
    now.mockRestore();
  });

  it('keeps an already confirmed order and tracking action visible during recovery', async () => {
    const user = userEvent.setup();
    renderPage();
    await openAndFillCheckout(user);
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }));
    expect(await screen.findByRole('heading', { name: 'Pedido enviado' })).toBeInTheDocument();

    dispatchPersistedPageShow();

    expect(screen.getByRole('heading', { name: 'Pedido enviado' })).toBeInTheDocument();
    expect(screen.getByText('PED-1001')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Pedido enviado' })).toBeInTheDocument();
  });

  it('closes editing and recoverable checkout states without clearing the cart', async () => {
    const user = userEvent.setup();
    renderPage();
    await openAndFillCheckout(user);
    dispatchPersistedPageShow();
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Finalizar pedido' })).not.toBeInTheDocument();
    });
    expect(window.sessionStorage.getItem(getPublicCartStorageKey('mi-negocio'))).not.toBeNull();

    await user.click(screen.getByRole('button', {
      name: 'Ver carrito, 1 unidades, subtotal $80.00'
    }));
    await user.click(screen.getByRole('button', { name: 'Continuar pedido' }));
    serviceMocks.createPublicOrder.mockRejectedValueOnce(
      new EcommercePublicError('ECOMMERCE_ORDER_CREATE_FAILED', 'No se pudo confirmar.')
    );
    await user.type(await screen.findByLabelText('Nombre *'), 'Cliente QA');
    await user.type(screen.getByLabelText('Teléfono *'), '9610000000');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar pedido' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo confirmar');

    dispatchPersistedPageShow();
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Finalizar pedido' })).not.toBeInTheDocument();
    });
    expect(window.sessionStorage.getItem(getPublicCartStorageKey('mi-negocio'))).not.toBeNull();
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
    await fillDeliveryAddress(user, { street: 'Calle de recuperación 10' });
    await user.type(screen.getByLabelText('Notas'), 'Conservar estos datos');
    await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo confirmar el pedido');
    expect(screen.getByLabelText('Nombre *')).toHaveValue('Cliente QA');
    expect(screen.getByLabelText('Teléfono *')).toHaveValue('9610000000');
    expect(screen.getByLabelText('Calle / avenida / camino *')).toHaveValue('Calle de recuperación 10');
    expect(screen.getByLabelText('Referencia para llegar')).toHaveValue('Frente al parque');
    expect(screen.getByLabelText('Notas')).toHaveValue('Conservar estos datos');
    expect(window.sessionStorage.getItem(getPublicCartStorageKey('mi-negocio'))).not.toBeNull();
    const firstKey = serviceMocks.createPublicOrder.mock.calls[0][1].idempotencyKey;
    expect(serviceMocks.createPublicOrder.mock.calls[0][1].customer).toMatchObject({
      address: 'Calle de recuperación 10 #10, Centro, Tuxtla Gutiérrez, Chiapas, CP 29000',
      deliveryAddress: {
        street: 'Calle de recuperación 10',
        municipality: 'Tuxtla Gutiérrez',
        postalCode: '29000',
        reference: 'Frente al parque'
      },
      fulfillmentMethod: 'delivery'
    });

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
    await fillDeliveryAddress(user, { street: 'Avenida primera 25', reference: 'Junto a la farmacia' });
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
    expect(screen.getByLabelText('Calle / avenida / camino *')).toHaveValue('');
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
