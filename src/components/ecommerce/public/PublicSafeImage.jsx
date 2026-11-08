import { useState } from 'react';
import LogoMark from '../../common/LogoMark';
import './PublicProductImageSizing.css';

export function isSafePublicImageUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function PublicSafeImage({
  src,
  alt,
  className = '',
  fallbackLabel = 'Imagen no disponible',
  eager = false,
}) {
  const [failedSrc, setFailedSrc] = useState(null);
  const safeSrc = isSafePublicImageUrl(src) ? src : null;

  // Failure belongs to the URL, not the React component reused by the catalog.
  if (!safeSrc || failedSrc === safeSrc) {
    return (
      <div className={`${className} public-safe-image public-safe-image--fallback`} role="img" aria-label={fallbackLabel}>
        <LogoMark className="public-safe-image__logo-mark" />
      </div>
    );
  }

  return (
    <img
      className={`${className} public-safe-image`}
      src={safeSrc}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      onError={() => setFailedSrc(safeSrc)}
    />
  );
}

export default PublicSafeImage;
