// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const closeNotificationCenter = vi.fn();

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({ closeNotificationCenter })
}));

import NotificationItem from '../NotificationItem';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

const notification = {
  id: 'notification-1',
  type: 'ecommerce',
  severity: 'info',
  title: 'Nuevo pedido online EC-00000011',
  body: '1 artículo · $20.00 MXN · Recoger en el negocio',
  action_label: 'Ver pedido',
  action_route: '/pedidos-online?order=11111111-1111-4111-8111-111111111111',
  metadata: { category: 'ecommerce' },
  is_read: false,
  is_dismissible: true
};

describe('NotificationItem ecommerce', () => {
  it('shows the ecommerce label, marks read, closes the center and navigates', async () => {
    const onRead = vi.fn().mockResolvedValue({ success: true });

    render(
      <MemoryRouter initialEntries={['/']}>
        <NotificationItem
          notification={notification}
          onRead={onRead}
          onArchive={vi.fn()}
          preferences={{}}
        />
        <LocationProbe />
      </MemoryRouter>
    );

    expect(screen.getByText('Pedidos online')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver pedido' }));

    await waitFor(() => {
      expect(onRead).toHaveBeenCalledWith('notification-1');
      expect(closeNotificationCenter).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('location')).toHaveTextContent('/pedidos-online?order=11111111-1111-4111-8111-111111111111');
    });
  });

  it('does not navigate when marking read is denied', async () => {
    const onRead = vi.fn().mockResolvedValue({ success: false, code: 'NOTIFICATION_NOT_FOUND' });

    render(
      <MemoryRouter initialEntries={['/']}>
        <NotificationItem
          notification={notification}
          onRead={onRead}
          onArchive={vi.fn()}
          preferences={{}}
        />
        <LocationProbe />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ver pedido' }));

    await waitFor(() => expect(onRead).toHaveBeenCalled());
    expect(closeNotificationCenter).not.toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });
});
