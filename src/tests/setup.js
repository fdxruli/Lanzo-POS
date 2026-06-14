// src/tests/setup.js
// Configuración global para Vitest — jsdom 28
//
// IMPORTANTE: En jsdom 28, window.location (y todos sus métodos: reload, replace, assign)
// son completamente non-configurable y non-writable. Cualquier intento de redefinirlos
// con Object.defineProperty, vi.stubGlobal o delete lanza TypeError.
//
// Solución adoptada:
//   - Para pathname/search: usar window.history.pushState (funciona en jsdom)
//   - Para reload/replace: probar efectos secundarios, no la llamada directa
//   - Solo mockeamos window.open y navigator.clipboard (sí son redefinibles)

import { vi, beforeAll, afterAll, beforeEach } from 'vitest';

// ── Mock: window.open ─────────────────────────────────────────────────────────
Object.defineProperty(window, 'open', {
  writable: true,
  configurable: true,
  value: vi.fn(),
});

// ── Polyfill: navigator.clipboard ─────────────────────────────────────────────
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

// ── Reset entre tests ─────────────────────────────────────────────────────────
beforeEach(() => {
  window.open.mockClear?.();
  navigator.clipboard.writeText.mockClear?.();
  // Resetear URL al root
  window.history.pushState({}, '', '/');
  // Resetear navigator.onLine a true para evitar contaminación entre tests
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

// ── Silenciar console.error esperado de React ErrorBoundary ───────────────────
beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    const msg = String(args[0] ?? '');
    if (
      msg.includes('The above error occurred') ||
      msg.includes('React will try to recreate') ||
      msg.includes('BombComponent') ||
      msg.includes('ConditionalBomb') ||
      msg.includes('ErrorBoundary')
    ) return;
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});
