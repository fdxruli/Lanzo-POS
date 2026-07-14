// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import PublicLanzoLandingPage from '../PublicLanzoLandingPage';

describe('PublicLanzoLandingPage administrative CTA cutover', () => {
  afterEach(cleanup);

  it('sends every acquisition CTA to the administrative application', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/conoce-lanzo?tienda=negocio-ejemplo']}>
        <PublicLanzoLandingPage />
      </MemoryRouter>
    );

    const welcomeLinks = [...container.querySelectorAll('a')]
      .filter((link) => link.href.includes('welcome=1'));
    expect(welcomeLinks).toHaveLength(4);
    welcomeLinks.forEach((link) => {
      expect(link).toHaveAttribute('href', 'https://lanzo-pos.vercel.app/?welcome=1');
    });
    expect(container.querySelector('a[href="/?welcome=1"]')).toBeNull();
  });

  it('keeps the return-to-store navigation relative to the current public origin', () => {
    render(
      <MemoryRouter initialEntries={['/conoce-lanzo?tienda=negocio-ejemplo']}>
        <PublicLanzoLandingPage />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: 'Volver a la tienda' }))
      .toHaveAttribute('href', '/tienda/negocio-ejemplo');
  });
});

