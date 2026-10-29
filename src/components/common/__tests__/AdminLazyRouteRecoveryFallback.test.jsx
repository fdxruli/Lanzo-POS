// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import AdminLazyRouteRecoveryFallback from '../AdminLazyRouteRecoveryFallback';

describe('AdminLazyRouteRecoveryFallback', () => {
  it('does not navigate or retry from an obsolete actor or tenant context', () => {
    const error = new TypeError(
      'Failed to fetch dynamically imported module: https://lanzo.test/assets/Ventas-old.js'
    );

    render(
      <MemoryRouter initialEntries={['/ventas']}>
        <AdminLazyRouteRecoveryFallback
          error={error}
          isContextCurrent={() => false}
          initiallyStale
        />
      </MemoryRouter>
    );

    expect(screen.getByText(/el contexto de negocio cambió/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /volver al inicio|actualizar archivos/i })).not.toBeInTheDocument();
  });
});
