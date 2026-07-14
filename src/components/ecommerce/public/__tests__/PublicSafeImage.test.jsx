// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import PublicSafeImage, { isSafePublicImageUrl } from '../PublicSafeImage';

afterEach(cleanup);

describe('PublicSafeImage', () => {
  it('renders a valid public image URL without exposing it as visible text', () => {
    const publicUrl = 'https://fixtures.lanzo.invalid/product.png';
    render(
      <PublicSafeImage
        src={publicUrl}
        alt="Foto fixture válida"
        fallbackLabel="Producto sin imagen"
      />
    );

    const image = screen.getByRole('img', { name: 'Foto fixture válida' });
    expect(image).toHaveAttribute('src', publicUrl);
    expect(screen.queryByText(publicUrl)).not.toBeInTheDocument();
  });

  it.each([
    'file:///private/customer.png',
    'data:text/html,private',
    'javascript:alert(1)',
    'not-a-url',
  ])('rejects an unsafe image URL: %s', (unsafeUrl) => {
    expect(isSafePublicImageUrl(unsafeUrl)).toBe(false);
    render(
      <PublicSafeImage
        src={unsafeUrl}
        alt="No debe renderizarse"
        fallbackLabel="Producto sin imagen"
      />
    );

    expect(screen.queryByRole('img', { name: 'No debe renderizarse' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Producto sin imagen' })).toBeInTheDocument();
  });

  it('uses the Lanzo mark when the primary image is missing', () => {
    render(
      <PublicSafeImage
        src=""
        alt="Foto del producto"
        fallbackLabel="Producto sin imagen"
      />
    );

    const placeholder = screen.getByRole('img', { name: 'Producto sin imagen' });
    expect(placeholder).toHaveClass('public-safe-image--fallback');
    expect(placeholder.querySelector('.public-safe-image__logo-mark')).toBeInTheDocument();
  });

  it('uses the Lanzo mark after the primary image fails to load', () => {
    render(
      <PublicSafeImage
        src="https://example.com/product.png"
        alt="Foto del producto"
        fallbackLabel="Producto sin imagen"
      />
    );

    fireEvent.error(screen.getByRole('img', { name: 'Foto del producto' }));

    const placeholder = screen.getByRole('img', { name: 'Producto sin imagen' });
    expect(placeholder).toHaveClass('public-safe-image--fallback');
    expect(placeholder.querySelector('.public-safe-image__logo-mark')).toBeInTheDocument();
  });
});
