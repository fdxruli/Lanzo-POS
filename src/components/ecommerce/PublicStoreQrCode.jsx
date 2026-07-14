import { useMemo } from 'react';
import { BarcodeFormat, QRCodeWriter } from '@zxing/library';

const QR_SIZE = 168;
const QR_HINTS = new Map();

const createQrPath = (value) => {
  if (!value) return { path: '', size: QR_SIZE, failed: false };

  try {
    const matrix = new QRCodeWriter().encode(
      value,
      BarcodeFormat.QR_CODE,
      QR_SIZE,
      QR_SIZE,
      QR_HINTS
    );
    const width = matrix.getWidth();
    const height = matrix.getHeight();
    const commands = [];

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (matrix.get(x, y)) commands.push(`M${x} ${y}h1v1h-1z`);
      }
    }

    const path = commands.join('');
    return { path, size: width, failed: !path };
  } catch {
    return { path: '', size: QR_SIZE, failed: true };
  }
};

export default function PublicStoreQrCode({ value }) {
  const qr = useMemo(() => createQrPath(value), [value]);
  if (!value) return null;
  if (qr.failed) {
    return (
      <div role="status" aria-live="polite" data-qr-value={value}>
        No se pudo generar el código QR. Puedes copiar el enlace de la tienda.
      </div>
    );
  }
  if (!qr.path) return null;

  return (
    <svg
      className="ecom-admin-store-qr"
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      role="img"
      aria-label="Codigo QR de la tienda"
      data-qr-value={value}
      shapeRendering="crispEdges"
    >
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={qr.path} fill="#111" />
    </svg>
  );
}
