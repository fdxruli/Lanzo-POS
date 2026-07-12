// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import PublicSafeImage from '../PublicSafeImage';

describe('PublicSafeImage', () => {
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
