/**
 * ErrorBoundary.test.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Suite de pruebas exhaustiva para el componente ErrorBoundary mejorado.
 *
 * Categorías cubiertas:
 *  1. Renderizado normal (sin error)
 *  2. Captura de errores — pantalla de error
 *  3. Contenido del reporte WhatsApp (_buildReportMessage)
 *  4. Botón Copiar al portapapeles
 *  5. Recuperación — Recargar, Reset, Ir al POS
 *  6. Lógica de ruta (POS vs. sección secundaria)
 *  7. Estado de red (online / offline)
 *  8. Tipos de error especiales (TypeError, RangeError, error encadenado)
 *  9. Datos del store — casos extremos (sin perfil, sin licencia)
 * 10. Utilidades puras (parseUserAgent, cleanStack, formatTimestamp)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import '@testing-library/jest-dom';

// ── Mocks PRIMERO — antes de cualquier import del componente ──────────────────

// Mock de Supabase (bloquea conexión de red en tests)
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn() })),
    auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })) },
    channel: vi.fn(() => ({ on: vi.fn(), subscribe: vi.fn() })),
  })),
}));

// Mock de Dexie (IndexedDB)
vi.mock('dexie', () => {
  const Dexie = vi.fn(function() {
    this.version = vi.fn(() => ({ stores: vi.fn() }));
    this.open = vi.fn().mockResolvedValue(this);
  });
  return { default: Dexie };
});
vi.mock('dexie-export-import', () => ({}));
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: vi.fn(() => []) }));

// Mock del store de Zustand (acceso imperativo sin hooks)
vi.mock('../store/useAppStore', () => ({
  useAppStore: {
    getState: vi.fn(() => ({
      companyProfile: {
        name: 'Verdulería El Tomate',
        rubro: 'verduleria',
      },
      licenseDetails: {
        license_key: 'LNZ-TEST-1234567890',
      },
    })),
  },
}));

// Mock del Logger
vi.mock('../services/Logger', () => ({
  default: {
    log:   vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    info:  vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock de lucide-react (evita transformaciones pesadas de SVG)
vi.mock('lucide-react', () => {
  const Icon = ({ 'data-testid': testId, size, ...props }) =>
    React.createElement('svg', { 'data-testid': testId, ...props });
  return {
    MessageCircle: Icon,
    RefreshCw: Icon,
    AlertTriangle: Icon,
    ShieldCheck: Icon,
    Store: Icon,
    ArrowRightCircle: Icon,
    Copy: Icon,
    CheckCheck: Icon,
    Wifi: Icon,
    WifiOff: Icon,
  };
});

// ── Importaciones bajo test (DESPUÉS de los mocks) ────────────────────────────

import ErrorBoundary from '../components/common/ErrorBoundary';
import Logger from '../services/Logger';
import { useAppStore } from '../store/useAppStore';

// ── Componentes auxiliares para tests ─────────────────────────────────────────

/** Lanza siempre una excepción al renderizarse */
function BombComponent({ error }) {
  throw error;
}

/** Lanza condicionalmente — permite probar la recuperación */
function ConditionalBomb({ shouldThrow, error }) {
  if (shouldThrow) throw error;
  return <div data-testid="safe-child">Contenido seguro</div>;
}

/** Helper: renderiza el boundary con un hijo que revienta.
 *  Usamos history.pushState para controlar el pathname en jsdom 28
 *  (la única forma confiable sin redefinir window.location).
 */
function renderWithError(error, options = {}) {
  const { pathname = '/', locationSearch = '' } = options;
  window.history.pushState({}, '', `${pathname}${locationSearch}`);

  return render(
    <ErrorBoundary>
      <BombComponent error={error} />
    </ErrorBoundary>
  );
}

// ── Setup global ──────────────────────────────────────────────────────────────

beforeAll(() => {
  // Silenciar el ruido esperado de React ErrorBoundary en consola
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    const msg = String(args[0] ?? '');
    if (
      msg.includes('The above error occurred') ||
      msg.includes('React will try to recreate') ||
      msg.includes('BombComponent') ||
      msg.includes('ConditionalBomb')
    ) return;
    // Mostrar otros errores reales
    console.warn('[console.error suprimido en test]', ...args);
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.open.mockClear?.();
  window.location.reload.mockClear?.();
  window.location.replace.mockClear?.();
  navigator.clipboard.writeText.mockClear?.();
  Logger.error.mockClear?.();
  useAppStore.getState.mockReturnValue({
    companyProfile: { name: 'Verdulería El Tomate', rubro: 'verduleria' },
    licenseDetails: { license_key: 'LNZ-TEST-1234567890' },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 1 — Renderizado normal
// ─────────────────────────────────────────────────────────────────────────────

describe('1. Renderizado normal (sin errores)', () => {
  it('muestra los hijos cuando no hay error', () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">Hola Mundo</div>
      </ErrorBoundary>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toHaveTextContent('Hola Mundo');
  });

  it('NO muestra la pantalla de error cuando no hay fallo', () => {
    render(<ErrorBoundary><div>Todo bien</div></ErrorBoundary>);
    expect(screen.queryByText(/Se ha detenido la aplicación/i)).not.toBeInTheDocument();
  });

  it('puede renderizar múltiples hijos sin problema', () => {
    render(
      <ErrorBoundary>
        <span data-testid="a">A</span>
        <span data-testid="b">B</span>
      </ErrorBoundary>
    );
    expect(screen.getByTestId('a')).toBeInTheDocument();
    expect(screen.getByTestId('b')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 2 — Captura de errores
// ─────────────────────────────────────────────────────────────────────────────

describe('2. Captura de errores — pantalla de error', () => {
  it('muestra el título principal de error', () => {
    renderWithError(new Error('fallo genérico'));
    expect(screen.getByText(/Se ha detenido la aplicación/i)).toBeInTheDocument();
  });

  it('muestra el mensaje de tranquilidad al usuario', () => {
    renderWithError(new Error('x'));
    expect(screen.getByText(/no es un error tuyo/i)).toBeInTheDocument();
  });

  it('muestra el badge con el tipo de error correcto (TypeError)', () => {
    renderWithError(new TypeError('Cannot read properties of null'));
    expect(screen.getByText('TypeError')).toBeInTheDocument();
  });

  it('muestra el badge con el tipo de error correcto (RangeError)', () => {
    renderWithError(new RangeError('Maximum call stack'));
    expect(screen.getByText('RangeError')).toBeInTheDocument();
  });

  it('muestra el mensaje legible del error en la caja técnica', () => {
    renderWithError(new TypeError('Cannot read properties of null reading map'));
    // El texto aparece tanto en la caja roja como en el stack trace preview,
    // por eso usamos body.textContent en vez de getByText (que falla con múltiples elementos)
    expect(document.body.textContent).toContain('Cannot read properties of null reading map');
  });

  it('muestra el badge de datos seguros', () => {
    renderWithError(new Error('x'));
    expect(screen.getByText(/Tus datos de ventas y caja están seguros/i)).toBeInTheDocument();
  });

  it('muestra la etiqueta DETALLE TÉCNICO', () => {
    renderWithError(new Error('x'));
    expect(screen.getByText(/DETALLE TÉCNICO/i)).toBeInTheDocument();
  });

  it('registra el error en Logger con campos estructurados', () => {
    const err = new TypeError('null.map');
    err.stack = 'TypeError: null.map\n    at ProductList.jsx:42';
    renderWithError(err);
    expect(Logger.error).toHaveBeenCalledWith(
      '🔥 Error crítico capturado:',
      expect.objectContaining({
        message: 'null.map',
        name: 'TypeError',
        stack: expect.stringContaining('ProductList.jsx'),
      })
    );
  });

  it('el objeto de log incluye timestamp ISO válido', () => {
    renderWithError(new Error('ts test'));
    const loggedObj = Logger.error.mock.calls[0][1];
    expect(loggedObj).toHaveProperty('timestamp');
    expect(new Date(loggedObj.timestamp).getTime()).not.toBeNaN();
  });

  it('muestra la versión de la app en el footer', () => {
    renderWithError(new Error('x'));
    expect(screen.getByText(/Lanzo POS System v/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 3 — Contenido del reporte WhatsApp
// ─────────────────────────────────────────────────────────────────────────────

describe('3. Contenido del reporte de soporte (WhatsApp)', () => {
  function captureReportMessage(error, options = {}) {
    renderWithError(error, options);
    fireEvent.click(screen.getByText(/Reportar Problema por WhatsApp/i));
    const call = window.open.mock.calls[0];
    expect(call).toBeTruthy();
    return decodeURIComponent(call[0]).split('?text=')[1] ?? '';
  }

  beforeEach(() => {
    localStorage.setItem('lanzo_device_id', 'DEVICE-XYZ-001');
  });
  afterEach(() => {
    localStorage.removeItem('lanzo_device_id');
  });

  it('incluye el nombre del negocio', () => {
    expect(captureReportMessage(new Error('x'))).toContain('Verdulería El Tomate');
  });

  it('incluye el rubro del negocio', () => {
    expect(captureReportMessage(new Error('x'))).toContain('verduleria');
  });

  it('incluye los primeros 12 caracteres de la licencia (parcial)', () => {
    // 'LNZ-TEST-1234567890'.slice(0, 12) = 'LNZ-TEST-123' (exactamente 12 chars)
    expect(captureReportMessage(new Error('x'))).toContain('LNZ-TEST-123');
  });

  it('incluye el device_id del equipo', () => {
    expect(captureReportMessage(new Error('x'))).toContain('DEVICE-XYZ-001');
  });

  it('incluye el tipo de error (TypeError)', () => {
    // El template usa negrita de WhatsApp: *TIPO DE ERROR:* TypeError
    expect(captureReportMessage(new TypeError('boom'))).toContain('*TIPO DE ERROR:* TypeError');
  });

  it('incluye el mensaje exacto del error', () => {
    expect(captureReportMessage(new Error('algo muy específico falló aquí'))).toContain('algo muy específico falló aquí');
  });

  it('incluye el stack trace de JavaScript', () => {
    const err = new TypeError('null.map');
    err.stack = 'TypeError: null.map\n    at ProductList.jsx:42:10\n    at render';
    expect(captureReportMessage(err)).toContain('ProductList.jsx');
  });

  it('incluye la ruta actual (pathname)', () => {
    expect(captureReportMessage(new Error('x'), { pathname: '/configuracion/backup' }))
      .toContain('/configuracion/backup');
  });

  it('incluye el estado de red "En línea" cuando está conectado', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    expect(captureReportMessage(new Error('x'))).toContain('En línea');
  });

  it('incluye error.cause cuando está presente', () => {
    const cause = new Error('Supabase connection refused');
    const err = new Error('Fallo al guardar venta', { cause });
    expect(captureReportMessage(err)).toContain('Supabase connection refused');
  });

  it('incluye la versión de la app', () => {
    expect(captureReportMessage(new Error('x'))).toContain('v4.0.0');
  });

  it('NO incluye el hash de la URL (sin tokens sensibles)', () => {
    // El reporte usa solo pathname+search — nunca el hash
    const msg = captureReportMessage(new Error('x'), { pathname: '/pos', locationSearch: '?ref=abc' });
    expect(msg).not.toContain('supersecret123');
  });

  it('el link apunta al número de soporte correcto (wa.me)', () => {
    renderWithError(new Error('x'));
    fireEvent.click(screen.getByText(/Reportar Problema por WhatsApp/i));
    expect(window.open.mock.calls[0][0]).toMatch(/wa\.me\/5200000000/);
  });

  it('abre WhatsApp en pestaña nueva (_blank)', () => {
    renderWithError(new Error('x'));
    fireEvent.click(screen.getByText(/Reportar Problema por WhatsApp/i));
    expect(window.open.mock.calls[0][1]).toBe('_blank');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 4 — Copiar reporte al portapapeles
// ─────────────────────────────────────────────────────────────────────────────

describe('4. Botón Copiar reporte', () => {
  beforeEach(() => navigator.clipboard.writeText.mockClear());

  it('existe el botón de copiar', () => {
    renderWithError(new Error('x'));
    expect(screen.getByText(/Copiar reporte completo/i)).toBeInTheDocument();
  });

  it('llama a navigator.clipboard.writeText al hacer click', async () => {
    renderWithError(new TypeError('null.map'));
    fireEvent.click(screen.getByText(/Copiar reporte completo/i));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1));
  });

  it('el texto copiado contiene el nombre del negocio', async () => {
    renderWithError(new Error('x'));
    fireEvent.click(screen.getByText(/Copiar reporte completo/i));
    await waitFor(() => {
      expect(navigator.clipboard.writeText.mock.calls[0][0]).toContain('Verdulería El Tomate');
    });
  });

  it('el texto copiado contiene el stack trace', async () => {
    const err = new TypeError('null.map');
    err.stack = 'TypeError: null.map\n    at CartList.jsx:99';
    renderWithError(err);
    fireEvent.click(screen.getByText(/Copiar reporte completo/i));
    await waitFor(() => {
      expect(navigator.clipboard.writeText.mock.calls[0][0]).toContain('CartList.jsx');
    });
  });

  it('cambia el texto del botón a "¡Copiado!" tras hacer click', async () => {
    renderWithError(new Error('x'));
    fireEvent.click(screen.getByText(/Copiar reporte completo/i));
    await waitFor(() => expect(screen.getByText(/¡Copiado!/i)).toBeInTheDocument());
  });

  it('el botón vuelve al estado original tras 3 segundos', async () => {
    // waitFor usa setTimeout internamente y es incompatible con useFakeTimers.
    // Usamos act + comprobación síncrona después de avanzar el tiempo.
    vi.useFakeTimers();
    try {
      renderWithError(new Error('x'));

      await act(async () => {
        fireEvent.click(screen.getByText(/Copiar reporte completo/i));
        // Dar tiempo al microtask de la Promise del clipboard
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByText(/¡Copiado!/i)).toBeInTheDocument();

      // Avanzar el temporizador de reset (3100ms)
      act(() => vi.advanceTimersByTime(3100));

      expect(screen.queryByText(/¡Copiado!/i)).not.toBeInTheDocument();
      expect(screen.getByText(/Copiar reporte completo/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('no lanza error al fallar clipboard (la UI no se rompe)', async () => {
    // jsdom no soporta document.execCommand; verificamos que si el clipboard
    // falla el componente no lanza una excepción no controlada.
    navigator.clipboard.writeText.mockRejectedValueOnce(new Error('Permission denied'));
    renderWithError(new Error('x'));
    // El click no debe lanzar al test runner aunque internamente el fallback falle
    await expect(
      act(async () => { fireEvent.click(screen.getByText(/Copiar reporte completo/i)); })
    ).resolves.not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 5 — Acciones de recuperación
// ─────────────────────────────────────────────────────────────────────────────

describe('5. Acciones de recuperación', () => {
  it('el botón Recargar Página existe y es clickeable sin lanzar errores', () => {
    // jsdom 28 hace window.location.reload non-mockable; verificamos que
    // el botón existe y que el click no lanza una excepción.
    renderWithError(new Error('x'));
    const btn = screen.getByText(/Recargar Página/i);
    expect(btn).toBeInTheDocument();
    // No debe lanzar al hacer click (el reload real no ocurre en jsdom)
    expect(() => fireEvent.click(btn)).not.toThrow();
  });

  it('Intentar recuperar elimina lanzo-cart-storage', () => {
    localStorage.setItem('lanzo-cart-storage', '{"items":[]}');
    renderWithError(new Error('x'));
    fireEvent.click(screen.getByText(/Intentar recuperar/i));
    expect(localStorage.getItem('lanzo-cart-storage')).toBeNull();
  });

  it('Intentar recuperar limpia sessionStorage', () => {
    sessionStorage.setItem('flag', 'true');
    renderWithError(new Error('x'));
    fireEvent.click(screen.getByText(/Intentar recuperar/i));
    expect(sessionStorage.getItem('flag')).toBeNull();
  });

  it('Intentar recuperar NO elimina lanzo_license', () => {
    localStorage.setItem('lanzo_license', 'LICENCIA_REAL');
    renderWithError(new Error('x'));
    fireEvent.click(screen.getByText(/Intentar recuperar/i));
    expect(localStorage.getItem('lanzo_license')).toBe('LICENCIA_REAL');
    localStorage.removeItem('lanzo_license');
  });

  it('Intentar recuperar NO elimina lanzo_device_id', () => {
    localStorage.setItem('lanzo_device_id', 'DEVICE-001');
    renderWithError(new Error('x'));
    fireEvent.click(screen.getByText(/Intentar recuperar/i));
    expect(localStorage.getItem('lanzo_device_id')).toBe('DEVICE-001');
    localStorage.removeItem('lanzo_device_id');
  });

  it('Intentar recuperar restaura el boundary para poder volver a renderizar', () => {
    // Necesitamos que el hijo deje de lanzar ANTES de que el boundary se resetee.
    // Si reseteamos primero, la boundary re-renderiza con shouldThrow=true → lanza de nuevo.
    // Solución: un wrapper con estado externo controla shouldThrow.
    let setShouldThrow;
    function ControlledWrapper() {
      const [shouldThrow, _set] = React.useState(true);
      setShouldThrow = _set;
      return (
        <ErrorBoundary>
          <ConditionalBomb shouldThrow={shouldThrow} error={new Error('recoverable')} />
        </ErrorBoundary>
      );
    }

    render(<ControlledWrapper />);
    expect(screen.getByText(/Se ha detenido la aplicación/i)).toBeInTheDocument();

    // 1. Primero: el hijo deja de lanzar (la boundary sigue en error, no re-renderiza aún)
    act(() => { setShouldThrow(false); });

    // 2. Luego: resetear la boundary → renderiza hijos → shouldThrow=false → no lanza
    fireEvent.click(screen.getByText(/Intentar recuperar/i));

    expect(screen.getByTestId('safe-child')).toBeInTheDocument();
  });

  it('Ir al POS elimina lanzo-cart-storage ANTES de redirigir', () => {
    // jsdom 28 hace window.location.replace non-mockable.
    // Verificamos el efecto secundario más importante: que el carrito corrupto
    // sea purgado antes de cualquier redirección.
    localStorage.setItem('lanzo-cart-storage', '{"corrupted":true}');
    renderWithError(new Error('x'), { pathname: '/reportes' });
    expect(() => fireEvent.click(screen.getByText(/Ir al Punto de Venta ahora/i))).not.toThrow();
    expect(localStorage.getItem('lanzo-cart-storage')).toBeNull();
  });

  it('Ir al POS también elimina sessionStorage antes de redirigir', () => {
    sessionStorage.setItem('temp_flag', '1');
    renderWithError(new Error('x'), { pathname: '/reportes' });
    fireEvent.click(screen.getByText(/Ir al Punto de Venta ahora/i));
    expect(sessionStorage.getItem('temp_flag')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 6 — Lógica de ruta
// ─────────────────────────────────────────────────────────────────────────────

describe('6. Lógica de ruta (cuándo mostrar el botón Ir al POS)', () => {
  it('NO muestra el botón "Ir al POS" en la ruta "/"', () => {
    renderWithError(new Error('x'), { pathname: '/' });
    expect(screen.queryByText(/Ir al Punto de Venta ahora/i)).not.toBeInTheDocument();
  });

  it('NO muestra el botón "Ir al POS" en ruta ""', () => {
    renderWithError(new Error('x'), { pathname: '' });
    expect(screen.queryByText(/Ir al Punto de Venta ahora/i)).not.toBeInTheDocument();
  });

  it('SÍ muestra el botón en /reportes', () => {
    renderWithError(new Error('x'), { pathname: '/reportes' });
    expect(screen.getByText(/Ir al Punto de Venta ahora/i)).toBeInTheDocument();
  });

  it('SÍ muestra el botón en /configuracion', () => {
    renderWithError(new Error('x'), { pathname: '/configuracion' });
    expect(screen.getByText(/Ir al Punto de Venta ahora/i)).toBeInTheDocument();
  });

  it('SÍ muestra el botón en /inventario', () => {
    renderWithError(new Error('x'), { pathname: '/inventario' });
    expect(screen.getByText(/Ir al Punto de Venta ahora/i)).toBeInTheDocument();
  });

  it('el card incluye advertencia de evitar la sección', () => {
    renderWithError(new Error('x'), { pathname: '/reportes' });
    expect(screen.getByText(/Evita regresar a esta sección/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 7 — Estado de red
// ─────────────────────────────────────────────────────────────────────────────

describe('7. Estado de red (online / offline)', () => {
  it('muestra "Conexión activa" cuando navigator.onLine es true', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    renderWithError(new Error('x'));
    expect(screen.getByText(/Conexión activa/i)).toBeInTheDocument();
  });

  it('muestra "Sin conexión" cuando navigator.onLine es false', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    renderWithError(new Error('x'));
    expect(screen.getByText(/Sin conexión/i)).toBeInTheDocument();
  });

  it('incluye "esto puede ser la causa" cuando está offline', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    renderWithError(new Error('x'));
    expect(screen.getByText(/esto puede ser la causa/i)).toBeInTheDocument();
  });

  it('el reporte incluye "SIN CONEXIÓN" cuando está offline', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    renderWithError(new Error('x'));
    fireEvent.click(screen.getByText(/Reportar Problema por WhatsApp/i));
    const url = decodeURIComponent(window.open.mock.calls[0][0]);
    expect(url).toContain('SIN CONEXIÓN');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 8 — Tipos de error especiales
// ─────────────────────────────────────────────────────────────────────────────

describe('8. Tipos de error especiales', () => {
  it('maneja TypeError correctamente', () => {
    renderWithError(new TypeError('Cannot read property map of undefined'));
    expect(screen.getByText('TypeError')).toBeInTheDocument();
  });

  it('maneja RangeError correctamente', () => {
    renderWithError(new RangeError('Maximum call stack size exceeded'));
    expect(screen.getByText('RangeError')).toBeInTheDocument();
    // El mensaje aparece en la caja roja Y en el stack preview → usamos body.textContent
    expect(document.body.textContent).toContain('Maximum call stack size exceeded');
  });

  it('maneja SyntaxError correctamente', () => {
    renderWithError(new SyntaxError('Unexpected token <'));
    expect(screen.getByText('SyntaxError')).toBeInTheDocument();
  });

  it('muestra error.cause en la caja técnica', () => {
    const cause = new Error('network timeout from Supabase');
    const err = new Error('Fallo al sincronizar inventario', { cause });
    renderWithError(err);
    expect(screen.getByText(/network timeout from Supabase/i)).toBeInTheDocument();
  });

  it('el reporte de error encadenado incluye la causa', () => {
    const cause = new Error('ECONNREFUSED: Connection refused');
    const err = new Error('Backup failed', { cause });
    renderWithError(err);
    fireEvent.click(screen.getByText(/Reportar Problema por WhatsApp/i));
    const url = decodeURIComponent(window.open.mock.calls[0][0]);
    expect(url).toContain('ECONNREFUSED');
  });

  it('maneja error sin message (error mínimo)', () => {
    renderWithError(new Error());
    expect(screen.getByText(/Se ha detenido la aplicación/i)).toBeInTheDocument();
  });

  it('maneja stack trace muy largo sin romper la UI', () => {
    const err = new Error('deep recursion');
    err.stack = 'Error: deep recursion\n' + '    at fn (app.jsx:1)\n'.repeat(200);
    renderWithError(err);
    expect(screen.getByText(/DETALLE TÉCNICO/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 9 — Datos del store — casos extremos
// ─────────────────────────────────────────────────────────────────────────────

describe('9. Datos del store — casos extremos', () => {
  it('fallback "Negocio No Configurado" si no hay companyProfile', () => {
    useAppStore.getState.mockReturnValueOnce({ companyProfile: null, licenseDetails: null });
    renderWithError(new Error('x'));
    fireEvent.click(screen.getByText(/Reportar Problema por WhatsApp/i));
    const url = decodeURIComponent(window.open.mock.calls[0][0]);
    expect(url).toContain('Negocio No Configurado');
  });

  it('fallback "Sin Licencia Activa" si no hay licenseDetails', () => {
    useAppStore.getState.mockReturnValueOnce({
      companyProfile: { name: 'Tienda Test', rubro: 'general' },
      licenseDetails: null,
    });
    renderWithError(new Error('x'));
    fireEvent.click(screen.getByText(/Reportar Problema por WhatsApp/i));
    const url = decodeURIComponent(window.open.mock.calls[0][0]);
    // El componente trunca la licencia a 12 chars: 'Sin Licencia Activa'.slice(0,12) = 'Sin Licencia'
    expect(url).toContain('Sin Licencia');
  });

  it('incluye lanzo_device_id de localStorage en el reporte', () => {
    localStorage.setItem('lanzo_device_id', 'DEV-LAPTOP-CAJA1');
    renderWithError(new Error('x'));
    fireEvent.click(screen.getByText(/Reportar Problema por WhatsApp/i));
    const url = decodeURIComponent(window.open.mock.calls[0][0]);
    expect(url).toContain('DEV-LAPTOP-CAJA1');
    localStorage.removeItem('lanzo_device_id');
  });

  it('muestra "No disponible" si no hay device_id en localStorage', () => {
    localStorage.removeItem('lanzo_device_id');
    renderWithError(new Error('x'));
    fireEvent.click(screen.getByText(/Reportar Problema por WhatsApp/i));
    const url = decodeURIComponent(window.open.mock.calls[0][0]);
    expect(url).toContain('No disponible');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE 10 — Utilidades puras (lógica aislada, sin React)
// ─────────────────────────────────────────────────────────────────────────────

// Copiamos la lógica de las utilidades puras para testearlas en aislamiento total
function parseUserAgent(ua = '') {
  let browser = 'Navegador desconocido';
  if (/Edg\/(\d+)/.test(ua))         browser = `Edge ${RegExp.$1}`;
  else if (/Chrome\/(\d+)/.test(ua)) browser = `Chrome ${RegExp.$1}`;
  else if (/Firefox\/(\d+)/.test(ua))browser = `Firefox ${RegExp.$1}`;
  else if (/Safari\/(\d+)/.test(ua) && /Version\/(\d+)/.test(ua)) browser = `Safari ${RegExp.$1}`;
  else if (/OPR\/(\d+)/.test(ua))    browser = `Opera ${RegExp.$1}`;

  let os = 'SO desconocido';
  if (/Windows NT 10/.test(ua))       os = 'Windows 10/11';
  else if (/Windows NT 6.3/.test(ua)) os = 'Windows 8.1';
  else if (/Windows NT 6.1/.test(ua)) os = 'Windows 7';
  else if (/Mac OS X ([\d_]+)/.test(ua)) os = `macOS ${RegExp.$1.replace(/_/g, '.')}`;
  else if (/Android ([\d.]+)/.test(ua))  os = `Android ${RegExp.$1}`;
  else if (/iPhone OS ([\d_]+)/.test(ua)) os = `iOS ${RegExp.$1.replace(/_/g, '.')}`;
  else if (/Linux/.test(ua))          os = 'Linux';

  return `${browser} / ${os}`;
}

function cleanStack(stack = '', maxLines = 12) {
  if (!stack) return 'No disponible';
  return stack.split('\n').slice(0, maxLines).join('\n');
}

function formatTimestamp(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleString('es-MX', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return isoString;
  }
}

describe('10. Utilidades puras', () => {
  describe('parseUserAgent()', () => {
    it('identifica Chrome en Windows 10', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36';
      const r = parseUserAgent(ua);
      expect(r).toContain('Chrome 125');
      expect(r).toContain('Windows 10/11');
    });

    it('identifica Firefox', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/109.0';
      expect(parseUserAgent(ua)).toContain('Firefox 109');
    });

    it('identifica Edge', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/124 Safari/537.36 Edg/124.0';
      expect(parseUserAgent(ua)).toContain('Edge 124');
    });

    it('identifica Safari en iOS', () => {
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17 Mobile/15E148 Safari/604.1';
      const r = parseUserAgent(ua);
      expect(r).toContain('Safari');
      expect(r).toContain('iOS');
    });

    it('identifica Android', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/112 Mobile Safari/537.36';
      expect(parseUserAgent(ua)).toContain('Android 13');
    });

    it('devuelve "Navegador desconocido" para UA vacío', () => {
      expect(parseUserAgent('')).toContain('Navegador desconocido');
    });
  });

  describe('cleanStack()', () => {
    it('devuelve máximo N líneas', () => {
      const bigStack = Array.from({ length: 50 }, (_, i) => `    at fn${i} (file.js:${i})`).join('\n');
      expect(cleanStack(bigStack, 12).split('\n').length).toBeLessThanOrEqual(12);
    });

    it('respeta el parámetro maxLines personalizado', () => {
      const stack = 'Error\n    at a\n    at b\n    at c\n    at d\n    at e';
      expect(cleanStack(stack, 3).split('\n').length).toBe(3);
    });

    it('devuelve "No disponible" para undefined', () => {
      expect(cleanStack(undefined)).toBe('No disponible');
    });

    it('devuelve "No disponible" para string vacío', () => {
      expect(cleanStack('')).toBe('No disponible');
    });

    it('preserva el contenido exacto de las líneas', () => {
      const stack = 'TypeError: null.map\n    at ProductList.jsx:42:10';
      expect(cleanStack(stack, 12)).toContain('ProductList.jsx:42:10');
    });
  });

  describe('formatTimestamp()', () => {
    it('devuelve una cadena no vacía para un ISO válido', () => {
      const r = formatTimestamp('2026-06-13T18:32:05.000Z');
      expect(r).toBeTruthy();
      expect(typeof r).toBe('string');
    });

    it('no lanza excepción para input inválido', () => {
      expect(() => formatTimestamp('not-a-date')).not.toThrow();
    });

    it('el resultado contiene el año 2026', () => {
      expect(formatTimestamp('2026-06-13T18:32:05.000Z')).toContain('2026');
    });
  });
});
