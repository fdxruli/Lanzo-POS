// @vitest-environment jsdom
// Controlled diagnostic events, no POS operations.
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DevConsole from '../DevConsole';
import { clearDevConsoleEntries, installDevConsoleCapture } from '../../../services/devConsoleCapture';

vi.mock('../../../services/diagnostics/incidentEventCenter', () => ({ captureAsyncIncidentNotice: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('renders and copies the same useful sanitized diagnosis on mobile', async () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn()
  }));
  Element.prototype.scrollTo = vi.fn();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  ['log', 'info', 'warn', 'error', 'debug', 'trace', 'table'].forEach((method) => {
    vi.spyOn(console, method).mockImplementation(() => {});
  });
  clearDevConsoleEntries();
  installDevConsoleCapture();
  console.error('Error al crear licencia Lanzo Local:', {
    code: 'FREE_LICENSE_TRANSPORT_ERROR', message: 'ana@example.invalid LNZ-PRIVATE',
    licenseKey: 'LNZ-PRIVATE', token: 'jwt-private', password: 'password-private',
    customer: 'Ana Private', phone: '5551234567', amount: 9876.50,
    body: { rpc: 'rpc-private' }, deviceFingerprint: 'device-private',
    url: 'https://private.invalid/?access_token=private', state: { balance: 'state-private' }
  });
  render(<DevConsole />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir consola de desarrollo' }));
  expect(screen.getByText(/Conectividad · Diagnóstico técnico · FREE_LICENSE_TRANSPORT_ERROR/)).toBeVisible();
  expect(screen.getByText(/Módulo: Licencias · Operación: Crear licencia FREE/)).toBeVisible();
  fireEvent.click(screen.getByTitle('Copiar logs visibles'));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  const copied = writeText.mock.calls[0][0];
  expect(copied).toMatch(/^\[\d{4}-\d\d-\d\dT[^\]]+Z\] ERROR console:/);
  expect(copied).toContain('FREE_LICENSE_TRANSPORT_ERROR');
  expect(copied).toContain('Resultado: No confirmado');
  expect(document.body.textContent + copied).not.toMatch(/PRIVATE|private|Ana|5551234567|9876|access_token/);
  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar en logs' }), { target: { value: 'PGRST202' } });
  expect(screen.getByText('No hay registros para este filtro.')).toBeVisible();
});
