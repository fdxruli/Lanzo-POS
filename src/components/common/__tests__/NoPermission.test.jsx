// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../store/useAppStore', () => ({ useAppStore: (selector) => selector({}) }));
import NoPermission from '../NoPermission';

afterEach(cleanup);

describe('NoPermission', () => {
  it('uses actor-neutral copy when runtime authority is unavailable', () => {
    render(
      <MemoryRouter>
        <NoPermission />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: /no tienes acceso a esta sección/i }))
      .toBeInTheDocument();
    expect(screen.getByText(/No pudimos confirmar el acceso de tu sesión/))
      .toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/acerca-de');
    expect(screen.queryByText(/tu usuario staff/i)).not.toBeInTheDocument();
  });
});
