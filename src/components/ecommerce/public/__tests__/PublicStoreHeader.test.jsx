// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import PublicStoreHeader from '../PublicStoreHeader';

const portal = {
  name: 'Café Nube',
  businessType: ['food_service'],
  headline: 'Café de especialidad y pan recién hecho.',
  description: 'Un espacio para disfrutar café mexicano y pan artesanal.',
  logoUrl: 'https://fixtures.lanzo.invalid/logo.png',
  coverImageUrl: 'https://fixtures.lanzo.invalid/cover.jpg',
  address: 'Av. Central 123, Centro',
  whatsappPhone: '+52 (55) 1234-5678',
  contactEmail: 'hola@cafenube.example',
  minOrderTotal: 350,
  pickupEnabled: true,
  deliveryEnabled: true
};

const openAvailability = {
  code: 'OPEN',
  acceptingOrders: true
};

afterEach(cleanup);

describe('PublicStoreHeader', () => {
  it('shows the store identity with accessible cover and logo images', () => {
    render(
      <PublicStoreHeader
        portal={portal}
        hours={{ weekly: [], exceptions: [] }}
        availability={openAvailability}
      />
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Café Nube' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'Portada de Café Nube' }))
      .toHaveAttribute('src', portal.coverImageUrl);
    expect(screen.getByRole('img', { name: 'Logo de Café Nube' }))
      .toHaveAttribute('src', portal.logoUrl);
    expect(screen.getByText('Restaurante / Cocina')).toBeInTheDocument();
  });

  it('keeps the fallback for stores without a cover or logo', () => {
    render(
      <PublicStoreHeader
        portal={{ ...portal, coverImageUrl: '', logoUrl: '' }}
        hours={{ weekly: [], exceptions: [] }}
        availability={openAvailability}
      />
    );

    expect(screen.getByRole('img', { name: 'Portada de Café Nube' }))
      .toHaveClass('public-safe-image--fallback');
    expect(screen.getByRole('img', { name: 'Logo de Café Nube' }))
      .toHaveClass('public-safe-image--fallback');
  });

  it('adapts the cover container to a portrait image without changing its aspect ratio', () => {
    render(
      <PublicStoreHeader
        portal={portal}
        hours={{ weekly: [], exceptions: [] }}
        availability={openAvailability}
      />
    );

    const cover = screen.getByRole('img', { name: 'Portada de Café Nube' });
    Object.defineProperty(cover, 'naturalWidth', { configurable: true, value: 900 });
    Object.defineProperty(cover, 'naturalHeight', { configurable: true, value: 1200 });
    fireEvent.load(cover);

    expect(cover).toHaveClass('public-store-header__cover--portrait');
    expect(cover.parentElement).toHaveAttribute('data-cover-orientation', 'portrait');
  });

  it('keeps a horizontal cover in the wide banner layout', () => {
    render(
      <PublicStoreHeader
        portal={portal}
        hours={{ weekly: [], exceptions: [] }}
        availability={openAvailability}
      />
    );

    const cover = screen.getByRole('img', { name: 'Portada de Café Nube' });
    Object.defineProperty(cover, 'naturalWidth', { configurable: true, value: 1600 });
    Object.defineProperty(cover, 'naturalHeight', { configurable: true, value: 600 });
    fireEvent.load(cover);

    expect(cover).not.toHaveClass('public-store-header__cover--portrait');
    expect(cover.parentElement).toHaveAttribute('data-cover-orientation', 'landscape');
  });

  it('shows long business names without changing the single h1 hierarchy', () => {
    const longName = 'Mercado Artesanal, Café y Pan de la Colonia del Centro';
    render(
      <PublicStoreHeader
        portal={{ ...portal, name: longName }}
        hours={{ weekly: [], exceptions: [] }}
        availability={openAvailability}
      />
    );

    expect(screen.getByRole('heading', { level: 1, name: longName })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('labels order availability from the real order state', () => {
    const { rerender } = render(
      <PublicStoreHeader
        portal={portal}
        hours={{ weekly: [], exceptions: [] }}
        availability={openAvailability}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Pedidos');
    expect(screen.getByRole('status')).toHaveTextContent('Abierto');
    expect(screen.getByRole('status')).toHaveTextContent('recibiendo pedidos');
    expect(screen.getByRole('status', { name: /Disponibilidad para pedidos: Abierto/ })).toBeInTheDocument();

    rerender(
      <PublicStoreHeader
        portal={portal}
        hours={{ weekly: [], exceptions: [] }}
        availability={{ code: 'ORDERS_PAUSED', acceptingOrders: false }}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Pedidos pausados');
    expect(screen.getByRole('status')).not.toHaveTextContent('Abierto');
  });

  it('keeps business hours separate from whether legacy data accepts orders', () => {
    const today = new Date().getDay();
    render(
      <PublicStoreHeader
        portal={portal}
        hours={{
          weekly: [{ weekday: today, isOpen: true, opensAt: '09:00', closesAt: '18:00' }],
          exceptions: []
        }}
        availability={{ legacy: true }}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('No acepta pedidos');
    expect(screen.getByRole('status')).toHaveTextContent('Abierto hoy de 09:00 a 18:00');
  });

  it('keeps published contact, address, minimum order, and fulfillment information in the disclosure', () => {
    render(
      <PublicStoreHeader
        portal={portal}
        hours={{ weekly: [], exceptions: [] }}
        availability={openAvailability}
      />
    );

    const information = screen.getByText('Información');
    fireEvent.click(information);

    expect(information.closest('details')).toHaveAttribute('open');
    expect(screen.getByText(portal.description)).toBeInTheDocument();
    expect(screen.getByText(`Dirección: ${portal.address}`)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /WhatsApp/ }))
      .toHaveAttribute('href', 'https://wa.me/525512345678');
    expect(screen.getByRole('link', { name: portal.contactEmail }))
      .toHaveAttribute('href', `mailto:${portal.contactEmail}`);
    expect(screen.getByText(/Pedido mínimo/)).toBeInTheDocument();
    expect(screen.getAllByText('Recoger en negocio')).toHaveLength(2);
    expect(screen.getAllByText('Entrega a domicilio')).toHaveLength(2);
  });
});
