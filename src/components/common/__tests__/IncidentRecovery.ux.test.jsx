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
    expect(screen.getByRole('heading', { level: 2, name: '¿Necesitas ayuda?' })).toBeInTheDocument();
    expect(heading.closest('.incident-recovery')).toHaveClass('incident-recovery--standalone', 'incident-recovery--section');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('private-value');
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('separates recovery from help and places email guidance in the manual contact form', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mountFailure(new ReferenceError('render failed'), { recoverySurface: 'sales' });
    expect(screen.getByRole('heading', { name: 'No pudimos mostrar Ventas' })).toBeInTheDocument();
    const recovery = screen.getByRole('group', { name: 'Recuperar acceso' });
    const help = screen.getByRole('region', { name: '¿Necesitas ayuda?' });
    expect(within(recovery).getByRole('button', { name: 'Reintentar sección' })).toBeEnabled();
    expect(within(recovery).queryByRole('button', { name: 'Copiar diagnóstico' })).not.toBeInTheDocument();
    expect(within(help).getByRole('button', { name: 'Reportar problema' })).toBeEnabled();
    expect(within(help).queryByRole('link', { name: 'Abrir correo de soporte' })).not.toBeInTheDocument();
    fireEvent.click(within(help).getByRole('button', { name: 'Reportar problema' }));
    const contact = await screen.findByRole('region', { name: 'Reportar un problema' });
    expect(within(contact).getByRole('radio', { name: /Correo electrónico/ })).toBeInTheDocument();
    expect(within(contact).getByText(/Prepara un borrador y envíalo desde tu aplicación de correo/)).toBeInTheDocument();
    fireEvent.click(within(help).getByRole('button', { name: 'Copiar diagnóstico' }));
    await screen.findByRole('button', { name: 'Diagnóstico copiado' });
    expect(within(help).getByRole('status')).toHaveTextContent('Diagnóstico copiado. Revísalo antes de compartirlo.');
    expect(screen.getByRole('button', { name: 'Detalles del problema' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows trusted Welcome context and keeps advanced technical details collapsed and locally explicit', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const copyText = vi.fn().mockResolvedValue(true);
    mountFailure(Object.assign(new TypeError('customer=private-value'), {
      stack: 'at /Users/private-user/src/secret.jsx'
    }), { recoverySurface: 'welcome', copyText });

    const detailsButton = screen.getByRole('button', { name: 'Detalles del problema' });
    expect(detailsButton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(detailsButton);
    expect(screen.getByText('Área funcional').parentElement).toHaveTextContent('Acceso a Lanzo POS');
    expect(screen.getByText('Pantalla afectada').parentElement).toHaveTextContent('Bienvenida y activación de licencia');
    expect(screen.getByText('Ruta de navegación').parentElement).toHaveTextContent('/');
    expect(screen.getAllByText('Componente supervisado')[0].parentElement).toHaveTextContent('WelcomeModal');
    fireEvent.click(screen.getByRole('button', { name: 'Copiar diagnóstico' }));
    await screen.findByRole('button', { name: 'Diagnóstico copiado' });
    expect(copyText.mock.calls[0][0]).toContain('Área funcional: Acceso a Lanzo POS');
    expect(copyText.mock.calls[0][0]).toContain('Pantalla afectada: Bienvenida y activación de licencia');
    expect(copyText.mock.calls[0][0]).toContain('Componente supervisado: WelcomeModal');
    expect(copyText.mock.calls[0][0]).not.toContain('private-value');

    const advanced = screen.getByText('Información técnica adicional');
    expect(advanced.closest('details')).not.toHaveAttribute('open');
    fireEvent.click(advanced);
    expect(screen.getByText('Archivo asociado conocido').parentElement)
      .toHaveTextContent('src/components/common/WelcomeModal.jsx');
    expect(screen.getByText('Origen exacto de la excepción').parentElement).toHaveTextContent('No determinado');
    expect(document.body.textContent).not.toMatch(/private-value|private-user|secret\.jsx/);

    fireEvent.click(screen.getByRole('button', { name: 'Copiar información técnica adicional' }));
    await screen.findByRole('button', { name: 'Información avanzada copiada' });
    expect(copyText).toHaveBeenCalledWith(expect.stringContaining('Archivo asociado conocido: src/components/common/WelcomeModal.jsx'));
    expect(copyText.mock.calls[1][0]).not.toContain('private-user');
  });

  it('moves focus into the report and returns it to the help entrypoint', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mountFailure(new TypeError('synthetic'), { recoverySurface: 'welcome' });
    const trigger = screen.getByRole('button', { name: 'Reportar problema' });
    const reportRegionId = trigger.getAttribute('aria-controls');
    fireEvent.click(trigger);
    const heading = await screen.findByRole('heading', { name: 'Reportar un problema' });
    await waitFor(() => expect(heading).toHaveFocus());
    const recovery = heading.closest('.incident-recovery');
    const reportRegion = document.getElementById(reportRegionId);
    expect(reportRegion.parentElement).toBe(recovery);
    expect(reportRegion.previousElementSibling).toHaveClass('incident-recovery__layout');
    expect(reportRegion).not.toContainElement(screen.getByRole('region', { name: '¿Necesitas ayuda?' }));
    expect(reportRegion.querySelector('.incident-report__form')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('button', { name: 'Enviar reporte' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Folio:|No se confirmó la recepción|RPC no disponible/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Cerrar reporte' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar reporte' }));
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
    expect(await screen.findByText('El reintento no resolvió el problema. No seguiremos reiniciando esta sección.')).toBeVisible();
    expect(screen.queryByText('Recuperando esta sección…')).not.toBeInTheDocument();
    expect(exhausted).toHaveAccessibleDescription('El reintento disponible ya se utilizó.');
    expect(screen.getByRole('region', { name: '¿Necesitas ayuda?' })).toBeInTheDocument();
  });
});
