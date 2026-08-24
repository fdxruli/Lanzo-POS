// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  canEnterSettings: false,
  products: true
}));

vi.mock('../../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => ({ canEnterSettings: state.canEnterSettings })
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector({
    currentDeviceRole: 'staff',
    currentStaffUser: { id: 'staff-a' },
    canAccess: (permission) => permission === 'products' && state.products
  }))
}));

import PermissionRoute from '../PermissionRoute';
import SettingsRoute from '../SettingsRoute';

function HistoryControls() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate(-1)}>Atras</button>
      <button type="button" onClick={() => navigate(1)}>Adelante</button>
    </>
  );
}

const renderDirectUrl = (entry) => render(
  <MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route
        path="/productos"
        element={<PermissionRoute permission="products"><div>Productos permitidos</div></PermissionRoute>}
      />
      <Route
        path="/configuracion"
        element={<SettingsRoute><div>Configuracion permitida</div></SettingsRoute>}
      />
    </Routes>
  </MemoryRouter>
);

describe('Settings direct-route authorization', () => {
  afterEach(cleanup);

  beforeEach(() => {
    state.canEnterSettings = false;
    state.products = true;
  });

  it('allows Products but denies Configuracion for matrix A', () => {
    const products = renderDirectUrl('/productos');
    expect(screen.getByText('Productos permitidos')).toBeInTheDocument();
    products.unmount();

    renderDirectUrl('/configuracion');
    expect(screen.getByRole('alert')).toHaveTextContent('No tienes permiso');
    expect(screen.queryByText('Configuracion permitida')).not.toBeInTheDocument();
  });

  it('allows direct Settings navigation when the canonical shell policy grants it', () => {
    state.canEnterSettings = true;

    renderDirectUrl('/configuracion');
    expect(screen.getByText('Configuracion permitida')).toBeInTheDocument();
  });

  it('keeps Back and Forward fail closed after an actor loses Settings access', () => {
    state.canEnterSettings = true;
    const view = render(
      <MemoryRouter initialEntries={['/', '/configuracion']} initialIndex={1}>
        <HistoryControls />
        <Routes>
          <Route path="/" element={<div>Inicio seguro</div>} />
          <Route
            path="/configuracion"
            element={<SettingsRoute><div>Configuracion permitida</div></SettingsRoute>}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Configuracion permitida')).toBeInTheDocument();
    state.canEnterSettings = false;
    view.rerender(
      <MemoryRouter initialEntries={['/', '/configuracion']} initialIndex={1}>
        <HistoryControls />
        <Routes>
          <Route path="/" element={<div>Inicio seguro</div>} />
          <Route
            path="/configuracion"
            element={<SettingsRoute><div>Configuracion permitida</div></SettingsRoute>}
          />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Atras' }));
    expect(screen.getByText('Inicio seguro')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Adelante' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Configuracion permitida')).not.toBeInTheDocument();
  });
});
