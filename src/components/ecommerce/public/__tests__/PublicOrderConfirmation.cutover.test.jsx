// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PublicOrderConfirmation from '../PublicOrderConfirmation';

const trackingToken = `trk1_${'A'.repeat(43)}`;
const canonicalTrackingUrl = `https://lanzo-store.vercel.app/tienda/negocio-ejemplo/pedido/${trackingToken}`;
const order = {
  code: 'PED-CUTOVER-1',
  total: 120,
  currency: 'MXN',
  fulfillmentMethod: 'pickup',
  createdAt: '2026-07-14T12:00:00.000Z',
  trackingToken,
  trackingPath: `/tienda/negocio-ejemplo/pedido/${trackingToken}`
};

const renderConfirmation = () => render(
  <PublicOrderConfirmation
    order={order}
    slug="negocio-ejemplo"
    whatsapp={{ url: 'https://wa.me/525500000000?text=Pedido%20confirmado' }}
    whatsappEnabled
    onContinue={vi.fn()}
  />
);

describe('PublicOrderConfirmation cutover links', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) }
    });
  });
  afterEach(() => {
    cleanup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  });

  it('opens tracking on the standalone public origin', () => {
    renderConfirmation();
    expect(screen.getByRole('link', { name: 'Ver seguimiento del pedido' }))
      .toHaveAttribute('href', canonicalTrackingUrl);
  });

  it('copies the standalone public tracking URL', async () => {
    renderConfirmation();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar enlace de seguimiento' }));
    await waitFor(() => expect(navigator.clipboard.writeText)
      .toHaveBeenCalledWith(canonicalTrackingUrl));
  });

  it('includes the standalone public tracking URL in WhatsApp', () => {
    renderConfirmation();
    const href = screen.getByRole('link', { name: 'Enviar resumen por WhatsApp' })
      .getAttribute('href');
    expect(new URL(href).origin).toBe('https://wa.me');
    expect(new URL(href).searchParams.get('text')).toContain(canonicalTrackingUrl);
    expect(href).not.toContain('lanzo-pos.vercel.app/tienda');
  });
});
