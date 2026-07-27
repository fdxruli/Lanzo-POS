// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getTracking: vi.fn(),
  readCache: vi.fn(),
  writeCache: vi.fn(),
  clearCache: vi.fn(),
  subscribe: vi.fn()
}));

vi.mock('../../services/ecommerce/ecommerceOrderTrackingService', () => ({
  ECOMMERCE_TRACKING_POLL_MS: 45_000,
  getPublicOrderTracking: mocks.getTracking,
  readTrackingCache: mocks.readCache,
  writeTrackingCache: mocks.writeCache,
  clearTrackingCache: mocks.clearCache,
  subscribeToPublicTrackingSignals: mocks.subscribe
}));

import PublicOrderTrackingPage from '../PublicOrderTrackingPage';

const tracking = (overrides = {}) => ({
  orderCode: 'EC-101',
  status: 'preparing',
  fulfillmentMethod: 'pickup',
  createdAt: '2026-07-12T12:00:00.000Z',
  updatedAt: '2026-07-12T12:05:00.000Z',
  total: 100,
  currency: 'MXN',
  items: [{ name: 'Alitas', quantity: 2 }],
  publicMessage: 'En preparación',
  version: 2,
  paymentRegistered: false,
  storefrontAvailable: false,
  realtime: { enabled: false, topic: '' },
  ...overrides
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readCache.mockResolvedValue(null);
  mocks.writeCache.mockResolvedValue(true);
  mocks.clearCache.mockResolvedValue(true);
  mocks.subscribe.mockReturnValue(() => {});
});

afterEach(() => {
  cleanup();
});

describe('PublicOrderTrackingPage unpublished portal', () => {
  const renderTracking = (tokenCharacter = 'A') => render(
    <MemoryRouter initialEntries={[`/tienda/mi-negocio/pedido/trk1_${tokenCharacter.repeat(43)}`]}>
      <Routes>
        <Route path="/tienda/:slug/pedido/:trackingToken" element={<PublicOrderTrackingPage />} />
      </Routes>
    </MemoryRouter>
  );

  it('shows preparing and payment registered without inventing a completed fulfillment state', async () => {
    mocks.getTracking.mockResolvedValue(tracking({ paymentRegistered: true }));

    render(
      <MemoryRouter initialEntries={[`/tienda/mi-negocio/pedido/trk1_${'D'.repeat(43)}`]}>
        <Routes>
          <Route path="/tienda/:slug/pedido/:trackingToken" element={<PublicOrderTrackingPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findAllByText(/En preparaci/)).not.toHaveLength(0);
    expect(screen.getByText('Pago registrado')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Completado' })).not.toBeInTheDocument();
  });

  it('keeps the tracking visible without exposing catalog or new-order controls', async () => {
    mocks.getTracking.mockResolvedValue(tracking());

    render(
      <MemoryRouter initialEntries={[`/tienda/mi-negocio/pedido/trk1_${'A'.repeat(43)}`]}>
        <Routes>
          <Route path="/tienda/:slug/pedido/:trackingToken" element={<PublicOrderTrackingPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'EC-101' })).toBeInTheDocument();
    expect(screen.getByText('La tienda no está recibiendo pedidos en este momento.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Volver a la tienda' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /comprar|pedido nuevo|carrito/i })).not.toBeInTheDocument();
  });

  it.each([
    ['cancelled', 'Este pedido fue cancelado.'],
    ['rejected', 'El negocio no pudo aceptar este pedido.'],
    ['attention', 'El negocio necesita confirmar información de tu pedido.']
  ])('shows a specific %s message without the normal progress timeline', async (status, expected) => {
    mocks.getTracking.mockResolvedValue(tracking({ status }));

    renderTracking(status[0].toUpperCase());

    expect(await screen.findByText(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument();
    expect(screen.queryByText('Recibimos tu pedido y lo estamos revisando.')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Progreso del pedido' })).not.toBeInTheDocument();
  });

  it('keeps a paused storefront branded while hiding the return-to-store link', async () => {
    mocks.getTracking.mockResolvedValue(tracking({
      storefrontAvailable: false,
      storefront: {
        name: 'Alitas del Barrio',
        logoUrl: 'https://cdn.example.com/logo.png',
        theme: {
          primaryColor: '#ABCDEF',
          secondaryColor: 'javascript:alert(1)',
          cornerStyle: 'unknown',
          fontStyle: 'editorial'
        }
      }
    }));

    const { container } = renderTracking('P');

    expect(await screen.findByText('Alitas del Barrio')).toBeInTheDocument();
    expect(container.querySelector('img.public-tracking-store-logo')).toHaveAttribute('src', 'https://cdn.example.com/logo.png');
    expect(screen.queryByRole('link', { name: 'Volver a la tienda' })).not.toBeInTheDocument();
    const shell = container.querySelector('.public-tracking-shell');
    expect(shell.style.getPropertyValue('--store-primary')).toBe('#abcdef');
    expect(shell.style.getPropertyValue('--store-secondary')).toBe('#0369a1');
    expect(shell.style.getPropertyValue('--store-radius-card')).toBe('1rem');
    expect(shell.style.getPropertyValue('--store-font-family')).toContain('Georgia');
  });

  it('uses the safe logo fallback and accepts legacy payloads without storefront', async () => {
    mocks.getTracking.mockResolvedValue(tracking({
      storefront: { name: 'Tienda histórica', logoUrl: 'javascript:alert(1)', theme: null }
    }));

    const { unmount } = renderTracking('L');
    expect(await screen.findByText('Tienda histórica')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Logo del negocio' })).toHaveClass('public-safe-image--fallback');
    unmount();

    mocks.getTracking.mockResolvedValue(tracking({ storefront: undefined }));
    renderTracking('O');
    expect(await screen.findByRole('heading', { name: 'EC-101' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Logo del negocio' })).toBeInTheDocument();
  });

  it('shows the storefront link only when the server marks it available', async () => {
    mocks.getTracking.mockResolvedValue(tracking({ storefrontAvailable: true }));

    render(
      <MemoryRouter initialEntries={[`/tienda/mi-negocio/pedido/trk1_${'B'.repeat(43)}`]}>
        <Routes>
          <Route path="/tienda/:slug/pedido/:trackingToken" element={<PublicOrderTrackingPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('link', { name: 'Volver a la tienda' })).toHaveAttribute('href', '/tienda/mi-negocio');
  });

  it('shows the same not-found message for the uniform public tracking failure contract', async () => {
    const error = new Error('No se pudo encontrar este seguimiento.');
    error.code = 'ECOMMERCE_TRACKING_NOT_FOUND';
    mocks.getTracking.mockRejectedValue(error);

    render(
      <MemoryRouter initialEntries={[`/tienda/mi-negocio/pedido/trk1_${'C'.repeat(43)}`]}>
        <Routes>
          <Route path="/tienda/:slug/pedido/:trackingToken" element={<PublicOrderTrackingPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'No se encontró el seguimiento' })).toBeInTheDocument();
    expect(screen.getByText('No se pudo encontrar este seguimiento.')).toBeInTheDocument();
    expect(screen.queryByText(/demasiadas|límite|espera/i)).not.toBeInTheDocument();
  });
});
