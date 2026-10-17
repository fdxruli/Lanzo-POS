// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import IncidentErrorBoundary from '../IncidentErrorBoundary';
import { createIncidentLabAdapters } from '../../../qa/incidentLabAdapters';

function Broken({ error }) { throw error; }

const mountFailure = (error, props = {}) => {
  const lab = createIncidentLabAdapters();
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  return render(<IncidentErrorBoundary runtime={lab.boundaryRuntime}
    reportServices={lab.services} copyText={() => Promise.resolve(true)}
    openSupportMailto={vi.fn()} {...props}><Broken error={error} /></IncidentErrorBoundary>, { container: root });
};

afterEach(() => { cleanup(); document.getElementById('root')?.remove(); vi.restoreAllMocks(); });

describe('Recovery presentation in real application contexts', () => {
  it.each([TypeError, ReferenceError, Error])('contains %s at Welcome without promoting its severity', async (ErrorType) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mountFailure(new ErrorType('customer=private-value'), { recoverySurface: 'welcome' });
    const heading = screen.getByRole('heading', { level: 1, name: 'No pudimos mostrar la pantalla de acceso' });
    expect(heading.closest('.incident-recovery')).toHaveClass('incident-recovery--standalone', 'incident-recovery--section');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('private-value');
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('separates recovery from assistance and keeps email instructions next to email', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mountFailure(new ReferenceError('render failed'), { recoverySurface: 'sales' });
    expect(screen.getByRole('heading', { name: 'No pudimos mostrar Ventas' })).toBeInTheDocument();
    const recovery = screen.getByRole('group', { name: 'Recuperar acceso' });
    const help = screen.getByRole('region', { name: '¿Necesitas ayuda?' });
    expect(within(recovery).getByRole('button', { name: 'Reintentar sección' })).toBeEnabled();
    expect(within(recovery).queryByRole('button', { name: 'Copiar diagnóstico' })).not.toBeInTheDocument();
    expect(within(help).getByRole('button', { name: 'Reportar problema' })).toBeEnabled();
    const email = within(help).getByRole('button', { name: 'Abrir correo de soporte' });
    expect(email).toHaveAccessibleDescription(/Se abrirá tu aplicación de correo/);
    fireEvent.click(within(help).getByRole('button', { name: 'Copiar diagnóstico' }));
    await screen.findByRole('button', { name: 'Diagnóstico copiado' });
    expect(within(help).getByRole('status')).toHaveTextContent('Diagnóstico copiado. Revísalo antes de compartirlo.');
    expect(screen.getByRole('button', { name: 'Detalles del problema' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('moves focus into the report and returns it to the help entrypoint', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mountFailure(new TypeError('synthetic'), { recoverySurface: 'welcome' });
    fireEvent.click(screen.getByRole('button', { name: 'Reportar problema' }));
    const heading = await screen.findByRole('heading', { name: 'Enviar diagnóstico técnico' });
    await waitFor(() => expect(heading).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar', exact: true }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reportar problema' })).toHaveFocus());
  });

  it('does not use arbitrary context or exception data as display copy', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mountFailure(new Error('private-customer'), { recoverySurface: '/ventas/private-customer?token=secret' });
    expect(screen.getByRole('heading', { name: 'No pudimos mostrar esta sección' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/private-customer|token=secret/);
    expect(document.querySelector('.incident-recovery--standalone')).not.toBeInTheDocument();
  });

  it('keeps the real financial classifier and root isolation even on the Welcome surface', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mountFailure(Object.assign(new Error('synthetic'), { code: 'FINANCIAL_RESULT_UNKNOWN' }), { recoverySurface: 'welcome' });
    expect(screen.getByRole('alertdialog', { name: 'Necesitamos verificar esta operación' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.queryByRole('button', { name: /Reintentar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Volver al inicio' })).not.toBeInTheDocument();
    expect(document.getElementById('root').inert).toBe(true);
    expect(document.querySelector('.incident-recovery--standalone')).not.toBeInTheDocument();
  });

  it('keeps the retry budget and its explanation after a persistent Welcome fault', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mountFailure(new TypeError('synthetic'), { recoverySurface: 'welcome' });
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar sección' }));
    const exhausted = await screen.findByRole('button', { name: 'Reintento utilizado' });
    expect(exhausted).toBeDisabled();
    expect(exhausted).toHaveAccessibleDescription('El reintento disponible ya se utilizó.');
    expect(screen.getByRole('region', { name: '¿Necesitas ayuda?' })).toBeInTheDocument();
  });
});
