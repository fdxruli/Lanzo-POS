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

  it('keeps the return-to-store navigation relative to a valid store slug', () => {
    render(
      <MemoryRouter initialEntries={['/conoce-lanzo?tienda=negocio-ejemplo']}>
        <PublicLanzoLandingPage />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: 'Volver a la tienda' }))
      .toHaveAttribute('href', '/negocio-ejemplo');
  });

  it('uses the LANZO welcome link for direct visits and keeps the brand non-interactive', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/conoce-lanzo']}>
        <PublicLanzoLandingPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: 'Ir a LANZO' }))
      .toHaveAttribute('href', 'https://lanzo-pos.vercel.app/?welcome=1');
    expect(container.querySelector('.public-lanzo-brand').closest('a')).toBeNull();
    expect(screen.getByRole('link', { name: 'Conoce nuestra historia' }))
      .toHaveAttribute('href', '#historia');
  });

  it.each([
    ['', 'empty'],
    ['..%2F..', 'traversal'],
    ['api', 'reserved API path'],
    ['assets', 'reserved assets path'],
    ['src', 'reserved source path'],
    ['tienda', 'reserved store route'],
    ['conoce-lanzo', 'reserved landing route'],
    ['uno&tienda=dos', 'duplicate parameter'],
  ])('falls back to LANZO for an invalid or reserved store parameter (%s: %s)', (value) => {
    const query = value === 'uno&tienda=dos' ? `?tienda=${value}` : `?tienda=${value}`;
    render(
      <MemoryRouter initialEntries={[`/conoce-lanzo${query}`]}>
        <PublicLanzoLandingPage />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: 'Ir a LANZO' }))
      .toHaveAttribute('href', 'https://lanzo-pos.vercel.app/?welcome=1');
    expect(screen.queryByRole('link', { name: 'Volver a la tienda' })).not.toBeInTheDocument();
  });

  it('sets landing metadata without including the originating store query', () => {
    render(
      <MemoryRouter initialEntries={['/conoce-lanzo?tienda=negocio-ejemplo']}>
        <PublicLanzoLandingPage />
      </MemoryRouter>
    );

    expect(document.title).toBe('Conoce LANZO | Herramientas para pequeños negocios');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content'))
      .toContain('LANZO');
    expect(document.querySelector('link[rel="canonical"]'))
      .toHaveAttribute('href', 'https://lanzo-store.vercel.app/conoce-lanzo');
  });
});

