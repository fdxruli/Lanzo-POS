import { useState } from 'react';
import { LogoMark } from '../../common/Logo';

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
  const [failed, setFailed] = useState(false);
  const safeSrc = isSafePublicImageUrl(src) ? src : null;

  if (!safeSrc || failed) {
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
      onError={() => setFailed(true)}
    />
  );
}

export default PublicSafeImage;
