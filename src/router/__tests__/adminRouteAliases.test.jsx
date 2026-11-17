// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN_ROUTE_ALIASES } from '../adminRoutePaths';
import { AdminRouteAlias } from '../adminRouteAliases';
import { isAdminNotFoundPath } from '../adminRoutePaths';

afterEach(cleanup);

describe('admin legacy route aliases', () => {
  it.each(Object.entries(ADMIN_ROUTE_ALIASES))('redirects /%s to the existing module %s', (alias, destination) => {
    const router = createMemoryRouter([
      {
        path: '/',
        element: <Outlet />,
        children: [
          ...Object.entries(ADMIN_ROUTE_ALIASES).map(([path, to]) => ({
            path,
            element: <AdminRouteAlias to={to} />
          })),
          { path: 'ventas', element: <h1>Ventas</h1> },
          { path: 'clientes', element: <h1>Clientes</h1> }
        ]
      }
    ], { initialEntries: [`/${alias}`] });

    render(<RouterProvider router={router} />);

    expect(isAdminNotFoundPath(`/${alias}`)).toBe(false);
    expect(screen.getByRole('heading', {
      name: destination.endsWith('/ventas') ? 'Ventas' : 'Clientes'
    })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(destination);
  });
});
