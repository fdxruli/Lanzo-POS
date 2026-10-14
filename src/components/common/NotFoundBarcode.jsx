import { useEffect, useState } from 'react';
import {
  encodeNotFoundBarcodeValue,
  getNotFoundBarcodeBars,
  getNotFoundBarcodeValue,
} from '../../utils/notFoundBarcode';

const readThemeMode = () => (
  typeof document !== 'undefined'
    && document.documentElement?.getAttribute('data-theme') === 'dark'
    ? 'dark'
    : 'light'
);

function NotFoundBarcode() {
  const [themeMode, setThemeMode] = useState(readThemeMode);
  const value = getNotFoundBarcodeValue(themeMode);
  const modules = encodeNotFoundBarcodeValue(value);
  const bars = getNotFoundBarcodeBars(value);
  const viewBoxWidth = modules.length + 16;

  useEffect(() => {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') {
      return undefined;
    }

    const observer = new MutationObserver(() => {
      setThemeMode(readThemeMode());
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, []);

  return (
    <figure className="not-found-barcode" data-theme-mode={themeMode}>
      <svg
        className="not-found-barcode__graphic"
        viewBox={'0 0 ' + viewBoxWidth + ' 86'}
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
        data-barcode-value={value}
      >
        {bars.map((bar) => (
          <rect
            key={bar.x}
            x={bar.x}
            y={bar.y}
            width="0.9"
            height={bar.height}
            rx="0.14"
          />
        ))}
      </svg>
      <figcaption className="not-found-barcode__caption">
        <span>CÓDIGO DE RUTA</span>
        <code>{value}</code>
      </figcaption>
    </figure>
  );
}

export default NotFoundBarcode;
