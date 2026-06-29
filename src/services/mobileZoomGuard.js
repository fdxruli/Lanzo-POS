// src/services/mobileZoomGuard.js
// Bloquea zoom táctil accidental en móviles/PWA sin interferir con scroll normal de un dedo.

let isInstalled = false;

const isTouchDevice = () => (
  typeof window !== 'undefined'
  && (
    'ontouchstart' in window
    || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)
  )
);

const hasCoarsePointer = () => (
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(pointer: coarse)').matches
);

const preventDefault = (event) => {
  event.preventDefault();
};

const preventMultiTouchZoom = (event) => {
  if (event.touches && event.touches.length > 1) {
    event.preventDefault();
  }
};

export const installMobileZoomGuard = () => {
  if (isInstalled || typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  if (!isTouchDevice() && !hasCoarsePointer()) {
    return;
  }

  isInstalled = true;

  // Android/Chrome suele respetar el viewport. Esta guarda cubre pinch zoom accidental.
  document.addEventListener('touchmove', preventMultiTouchZoom, { passive: false });

  // iOS/Safari puede ignorar parcialmente user-scalable=no; estos eventos cubren esa ruta.
  document.addEventListener('gesturestart', preventDefault, { passive: false });
  document.addEventListener('gesturechange', preventDefault, { passive: false });
  document.addEventListener('gestureend', preventDefault, { passive: false });
};
