// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let storeState;

vi.mock('../../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector(storeState)
}));

import EcommerceOrdersRoute from '../EcommerceOrdersRoute';

const renderRoute = () => render(
  <MemoryRouter>
    <EcommerceOrdersRoute>
      <div>Bandeja autorizada</div>
    </EcommerceOrdersRoute>
  </MemoryRouter>
);

describe('EcommerceOrdersRoute', () => {
  beforeEach(() => {
    storeState = {
      licenseDetails: { features: { ecommerce_order_inbox: true } },
      currentDeviceRole: 'admin',
      currentStaffUser: null
    };
  });

  it('allows an admin with the inbox feature', () => {
    renderRoute();
    expect(screen.getByText('Bandeja autorizada')).toBeInTheDocument();
  });

  it('allows staff with ecommerce even when settings and notifications are disabled', () => {
    storeState = {
      ...storeState,
      currentDeviceRole: 'staff',
      currentStaffUser: {
        permissions: {
          ecommerce: true,
          settings: false,
          notifications: false
        }
      }
    };

    renderRoute();
    expect(screen.getByText('Bandeja autorizada')).toBeInTheDocument();
  });

  it('blocks direct navigation for staff without ecommerce', () => {
    storeState = {
      ...storeState,
      currentDeviceRole: 'staff',
      currentStaffUser: {
        permissions: {
          ecommerce: false,
          settings: true,
          notifications: true
        }
      }
    };

    renderRoute();
    expect(screen.getByRole('alert')).toHaveTextContent('No tienes permiso');
    expect(screen.queryByText('Bandeja autorizada')).not.toBeInTheDocument();
  });

  it('blocks every actor when the inbox feature is disabled', () => {
    storeState = {
      ...storeState,
      licenseDetails: { features: { ecommerce_order_inbox: false } }
    };

    renderRoute();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
