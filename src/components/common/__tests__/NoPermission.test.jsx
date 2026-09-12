// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import NoPermission from '../NoPermission';

afterEach(cleanup);

describe('NoPermission', () => {
  it('uses actor-neutral copy when runtime authority is unavailable', () => {
    render(
      <MemoryRouter>
        <NoPermission />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: /no tienes permiso para acceder a esta sección/i }))
      .toBeInTheDocument();
    expect(screen.getByText('Tu sesión actual no tiene acceso a este módulo.'))
      .toBeInTheDocument();
    expect(screen.queryByText(/tu usuario staff/i)).not.toBeInTheDocument();
  });
});
