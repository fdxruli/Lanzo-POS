// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { BarcodeFormat, QRCodeWriter } from '@zxing/library';
import { describe, expect, it } from 'vitest';
import PublicStoreQrCode from '../PublicStoreQrCode';

const publicStoreUrl = 'https://lanzo-store.vercel.app/tienda/negocio-ejemplo';

const matrixPath = (matrix) => {
  const commands = [];
  for (let y = 0; y < matrix.getHeight(); y += 1) {
    for (let x = 0; x < matrix.getWidth(); x += 1) {
      if (matrix.get(x, y)) commands.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return commands.join('');
};

describe('PublicStoreQrCode with the real ZXing library', () => {
  it('renders a crisp, square SVG encoding the complete public URL', () => {
    expect(() => render(<PublicStoreQrCode value={publicStoreUrl} />)).not.toThrow();

    const svg = screen.getByRole('img', { name: 'Codigo QR de la tienda' });
    const path = svg.querySelector('path');
    const background = svg.querySelector('rect');
    const matrix = new QRCodeWriter().encode(
      publicStoreUrl,
      BarcodeFormat.QR_CODE,
      168,
      168,
      new Map()
    );

    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg).toHaveAttribute('data-qr-value', publicStoreUrl);
    expect(svg).toHaveAttribute('viewBox', '0 0 168 168');
    expect(svg).toHaveAttribute('shape-rendering', 'crispEdges');
    expect(path).toHaveAttribute('d', matrixPath(matrix));
    expect(path?.getAttribute('d')).not.toHaveLength(0);
    expect(path).toHaveAttribute('fill', '#111');
    expect(background).toHaveAttribute('fill', '#fff');
    expect(background).toHaveAttribute('width', '168');
    expect(background).toHaveAttribute('height', '168');
    expect(Array.from({ length: 168 }, (_, index) => (
      matrix.get(index, 0)
      || matrix.get(index, 167)
      || matrix.get(0, index)
      || matrix.get(167, index)
    )).some(Boolean)).toBe(false);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
