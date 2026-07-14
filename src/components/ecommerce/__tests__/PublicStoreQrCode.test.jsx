// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import PublicStoreQrCode from '../PublicStoreQrCode';

const { encode } = vi.hoisted(() => ({
  encode: vi.fn(() => ({
    getWidth: () => 2,
    getHeight: () => 2,
    get: (x, y) => x === y
  }))
}));

vi.mock('@zxing/library', () => ({
  BarcodeFormat: { QR_CODE: 'QR_CODE' },
  QRCodeWriter: class QRCodeWriter {
    encode(...args) {
      return encode(...args);
    }
  }
}));

describe('PublicStoreQrCode', () => {
  it('passes the complete public URL to the QR encoder', () => {
    const value = 'https://lanzo-store.vercel.app/tienda/negocio-ejemplo';
    render(<PublicStoreQrCode value={value} />);
    expect(encode).toHaveBeenCalledWith(value, 'QR_CODE', 168, 168);
    expect(screen.getByRole('img', { name: 'Codigo QR de la tienda' }))
      .toHaveAttribute('data-qr-value', value);
  });
});

