import { useMemo } from 'react';
import { BarcodeFormat, QRCodeWriter } from '@zxing/library';

const QR_SIZE = 168;

const createQrPath = (value) => {
  if (!value) return { path: '', size: QR_SIZE };
  const matrix = new QRCodeWriter().encode(
    value,
    BarcodeFormat.QR_CODE,
    QR_SIZE,
    QR_SIZE
  );
  const width = matrix.getWidth();
  const height = matrix.getHeight();
  const commands = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (matrix.get(x, y)) commands.push(`M${x} ${y}h1v1h-1z`);
    }
  }

  return { path: commands.join(''), size: width };
};

export default function PublicStoreQrCode({ value }) {
  const qr = useMemo(() => createQrPath(value), [value]);
  if (!value || !qr.path) return null;

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

