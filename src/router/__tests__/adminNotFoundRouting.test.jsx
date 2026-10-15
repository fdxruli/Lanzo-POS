// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { ADMIN_NOT_FOUND_ROUTE } from '../adminNotFoundRoute';
import { ADMIN_VALID_ROUTE_PATHS, isAdminNotFoundPath } from '../adminRoutePaths';
import {
  encodeNotFoundBarcodeValue,
  getNotFoundBarcodeValue,
} from '../../utils/notFoundBarcode';

const notFoundStyles = readFileSync(resolve(process.cwd(), 'src/pages/NotFoundPage.css'), 'utf8');

const createAdminRouter = (initialEntries) => createMemoryRouter([
  {
    path: '/',
    element: <div data-testid="admin-shell"><Outlet /></div>,
    children: [
      { index: true, element: <p>Inicio del punto de venta</p> },
      { path: 'acerca-de', element: <h1>Acerca de</h1> },
      { path: 'configuracion', element: <h1>Configuración</h1> },
      { path: 'productos', element: <h1>Productos</h1> },
      ADMIN_NOT_FOUND_ROUTE,
    ],
  },
], { initialEntries });

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
  window.history.replaceState(null, '', '/');
});

describe('ruta 404 del POS', () => {
  it('reconoce rutas administrativas válidas y limita el wildcard a rutas desconocidas', () => {
    ADMIN_VALID_ROUTE_PATHS.forEach((path) => {
      expect(isAdminNotFoundPath(path)).toBe(false);
      expect(isAdminNotFoundPath(path === '/' ? '/' : `${path}/`)).toBe(false);
    });

    expect(isAdminNotFoundPath('/ruta-que-no-existe')).toBe(true);
    expect(isAdminNotFoundPath('/productos/segmento-desconocido')).toBe(true);
    expect(isAdminNotFoundPath('/RENOVACION-URGENTE')).toBe(false);
  });

  it('define viewport seguro y composición para móvil, tablet y escritorio', () => {
    expect(notFoundStyles).toContain('100dvh');
    expect(notFoundStyles).toContain('env(safe-area-inset-top');
    expect(notFoundStyles).toContain('@media (min-width: 640px) and (max-width: 1023px)');
    expect(notFoundStyles).toContain('@media (min-width: 1024px)');
    expect(notFoundStyles).toContain('grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr)');
  });
  it('muestra el 404 amable dentro del Layout para una ruta inválida', () => {
    const { container } = render(<RouterProvider router={createAdminRouter(['/ruta-que-no-existe'])} />);

    expect(screen.getByTestId('admin-shell')).toBeInTheDocument();
    expect(container.querySelector('.not-found-page__card')).not.toBeInTheDocument();
    expect(container.querySelector('.not-found-barcode')).toBeInTheDocument();
    expect(container.querySelector('.not-found-barcode').closest('.not-found-page__card')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Parece que esta página no existe' })).toBeInTheDocument();
    expect(screen.getByText(
      'La dirección que intentaste abrir no está disponible. Puede que el enlace esté incompleto o que la página haya cambiado.'
    )).toBeInTheDocument();
    expect(screen.getByText('RUTA NO ENCONTRADA')).toBeInTheDocument();
    expect(screen.getByText('LANZO POS')).toBeInTheDocument();
    expect(screen.queryByText('CÓDIGO DE RUTA')).not.toBeInTheDocument();
    expect(screen.queryByText('LANZO-POS-404-CLARO')).not.toBeInTheDocument();
    expect(screen.queryByText(/NOT FOUND/i)).not.toBeInTheDocument();
  });

  it.each([
    ['/acerca-de', 'Acerca de'],
    ['/configuracion', 'Configuración'],
    ['/productos', 'Productos'],
  ])('deja que la ruta válida %s gane sobre el fallback', (path, heading) => {
    render(<RouterProvider router={createAdminRouter([path])} />);

    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.queryByRole('heading', {
      name: 'Parece que esta página no existe',
    })).not.toBeInTheDocument();
  });

  it('el botón de inicio navega al POS sin recargar ni cambiar el shell', async () => {
    const user = userEvent.setup();
    render(<RouterProvider router={createAdminRouter(['/ruta-que-no-existe'])} />);

    await user.click(screen.getByRole('button', { name: 'Volver al inicio' }));

    expect(screen.getByText('Inicio del punto de venta')).toBeInTheDocument();
    expect(screen.getByTestId('admin-shell')).toBeInTheDocument();
  });

  it('vuelve a / cuando no hay historial interno confiable', async () => {
    const user = userEvent.setup();
    window.history.replaceState({ idx: 0 }, '', '/');
    render(<RouterProvider router={createAdminRouter(['/ruta-que-no-existe'])} />);

    await user.click(screen.getByRole('button', { name: 'Volver atrás' }));

    expect(screen.getByText('Inicio del punto de venta')).toBeInTheDocument();
  });

  it('usa el historial interno cuando existe una ruta previa', async () => {
    const user = userEvent.setup();
    window.history.replaceState({ idx: 1 }, '', '/');
    render(<RouterProvider router={createAdminRouter(['/productos', '/ruta-que-no-existe'])} />);

    await user.click(screen.getByRole('button', { name: 'Volver atrás' }));

    expect(screen.getByRole('heading', { name: 'Productos' })).toBeInTheDocument();
  });

  it('codifica Lanzo POS y cambia de forma determinista con el tema', async () => {
    const { container } = render(<RouterProvider router={createAdminRouter(['/ruta-que-no-existe'])} />);
    const barcode = container.querySelector('[data-barcode-value]');

    expect(getNotFoundBarcodeValue('light')).toBe('LANZO-POS-404-CLARO');
    expect(getNotFoundBarcodeValue('dark')).toBe('LANZO-POS-404-OSCURO');
    expect(encodeNotFoundBarcodeValue(getNotFoundBarcodeValue('light')))
      .not.toBe(encodeNotFoundBarcodeValue(getNotFoundBarcodeValue('dark')));
    expect(barcode).toHaveAttribute('data-barcode-value', 'LANZO-POS-404-CLARO');

    document.documentElement.setAttribute('data-theme', 'dark');

    await waitFor(() => {
      expect(barcode).toHaveAttribute('data-barcode-value', 'LANZO-POS-404-OSCURO');
      expect(screen.getByText('LANZO POS')).toBeInTheDocument();
      expect(screen.queryByText('LANZO-POS-404-OSCURO')).not.toBeInTheDocument();
    });
  });
});
