// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AboutPage from '../AboutPage';

const state = vi.hoisted(() => ({
  store: null,
  actor: null,
  settingsAccess: null
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => selector(state.store))
}));

vi.mock('../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => state.actor
}));

vi.mock('../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => state.settingsAccess
}));

vi.mock('../../components/common/Logo', () => ({
  default: () => <span aria-hidden="true">Lanzo</span>
}));

const renderPage = () => render(
  <MemoryRouter>
    <AboutPage />
  </MemoryRouter>
);

const setCloudLicense = (status = 'active', valid = true) => {
  const gracePeriodEnds = status === 'grace_period'
    ? '2099-10-16T15:14:09.000Z'
    : null;
  const expiresAt = status === 'active'
    ? '2099-10-30T15:14:09.000Z'
    : null;
  const validatedAt = new Date(Date.now() - 1000).toISOString();

  state.store.licenseDetails = {
    valid,
    status,
    lifecycle_state: status,
    license_status: 'active',
    is_entitled: valid,
    is_in_grace: status === 'grace_period',
    plan_code: 'pro_monthly',
    max_devices: 5,
    expires_at: expiresAt,
    grace_period_ends: gracePeriodEnds,
    features: { cloud_pos_sync: true },
    effective_lifecycle_validation: {
      source: 'server_validation',
      status,
      valid,
      is_entitled: valid,
      is_in_grace: status === 'grace_period',
      expires_at: expiresAt,
      grace_period_ends: gracePeriodEnds,
      validated_at: validatedAt
    }
  };
  state.store.licenseStatus = status;
};

describe('AboutPage Telegram actions', () => {
  beforeEach(() => {
    state.store = {
      licenseDetails: {
        valid: true,
        status: 'active',
        features: { cloud_pos_sync: false },
        max_devices: 1
      },
      licenseStatus: 'active',
      companyProfile: { name: 'Café QA' },
      canAccess: () => false,
      currentDeviceRole: 'admin',
      currentAdminUser: { id: 'admin-1', permissions: [] },
      currentStaffUser: null
    };
    state.actor = {
      status: 'granted',
      actorType: 'admin',
      actorId: 'admin-1',
      sessionId: 'session-1',
      permissions: ['*']
    };
    state.settingsAccess = {
      isAuthorizedActor: true,
      isAdmin: true,
      actorType: 'admin',
      canEnterSettings: true
    };
  });

  afterEach(() => cleanup());

  it('previews the current Local team request and opens only the official Telegram chat', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Trabajo con un equipo/ }));
    fireEvent.click(screen.getByRole('button', { name: /Solicitar Lanzo Nube/ }));

    const dialog = screen.getByRole('dialog');
    const message = screen.getByLabelText(/Mensaje para solicitar Lanzo Nube/);
    const telegramLink = screen.getByRole('link', { name: /Abrir chat de Lanzo POS/ });
    const telegramUrl = new URL(telegramLink.href);

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(message.value).toContain('contratar Lanzo Nube');
    expect(message.value).toContain('Trabajo con un equipo.');
    expect(message.value).toContain('Café QA');
    expect(`${telegramUrl.origin}${telegramUrl.pathname}`).toBe('https://t.me/LanzoPOS_Oficial');
    expect(telegramUrl.searchParams.get('text')).toBe(message.value);
    expect(telegramLink).toHaveAttribute('target', '_blank');
    expect(telegramLink).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('button', { name: 'Cerrar vista previa' })).toHaveFocus();
  });

  it('rebuilds the preview after changing from team to solo and restores focus on close', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Trabajo con un equipo/ }));
    fireEvent.click(screen.getByRole('button', { name: /Consultar requisitos/ }));
    expect(screen.getByLabelText(/Mensaje para consultar requisitos/).value)
      .toContain('Trabajo con un equipo.');

    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
    fireEvent.click(screen.getByRole('button', { name: /Vendo desde un equipo/ }));
    const soloAction = screen.getByRole('button', { name: /Consultar Lanzo Nube/ });
    fireEvent.click(soloAction);

    const message = screen.getByLabelText(/Mensaje para consultar Lanzo Nube/);
    expect(message.value).toContain('Vendo desde un equipo.');
    expect(message.value).not.toContain('Trabajo con un equipo.');
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(soloAction).toHaveFocus();
  });

  it('does not advertise PRO again to an active Cloud admin and keeps help forms', () => {
    setCloudLicense();
    renderPage();

    expect(screen.getByRole('heading', { name: 'Atajos de Lanzo Nube' })).toBeInTheDocument();
    expect(screen.queryByText('OFERTA DE LANZAMIENTO')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Contactar soporte PRO/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Consultar renovación/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reportar problema/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sugerir mejora/ })).toBeInTheDocument();
  });

  it('offers general support to a staff actor without commercial actions', () => {
    setCloudLicense();
    state.store.currentDeviceRole = 'staff';
    state.store.currentAdminUser = null;
    state.store.currentStaffUser = { id: 'staff-1', permissions: [] };
    state.actor = { ...state.actor, actorType: 'staff', actorId: 'staff-1', permissions: [] };
    state.settingsAccess = {
      isAuthorizedActor: true,
      isAdmin: false,
      actorType: 'staff',
      canEnterSettings: false
    };
    renderPage();

    expect(screen.getByRole('button', { name: 'Contactar soporte' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Contactar soporte PRO/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Consultar renovación/ })).not.toBeInTheDocument();
  });

  it('shows reactivation only for a confirmed expired Cloud licence', () => {
    setCloudLicense('expired', false);
    renderPage();

    expect(screen.getByText('Vencido')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Atajos de Lanzo Nube' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Consultar reactivación/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('aparece vencido');
  });

  it('shows grace as a continuity question, not as active or new activation', () => {
    setCloudLicense('grace_period', true);
    renderPage();

    const currentPlan = screen.getByRole('region', { name: 'Tu plan actual' });
    expect(within(currentPlan).getByText('Periodo de gracia')).toBeInTheDocument();
    expect(currentPlan).toHaveTextContent(
      'Tu plan está en periodo de gracia. Puedes consultar la continuidad del servicio.'
    );
    expect(screen.getByRole('button', { name: /Consultar situación del plan/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Contactar soporte' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Solicitar Lanzo Nube/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Consultar situación del plan/ }));
    const preview = screen.getByRole('dialog');
    expect(preview).toHaveTextContent(/dar continuidad al servicio/i);
    expect(preview).not.toHaveTextContent(/contratar Lanzo Nube/i);
  });

  it('uses conservative support when the license status is unknown and closes with Escape', () => {
    setCloudLicense('pending', true);
    renderPage();

    const currentPlan = screen.getByRole('region', { name: 'Tu plan actual' });
    expect(within(currentPlan).getByText('Por confirmar', {
      selector: '.about-redesign__current-badge'
    })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Contactar soporte' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Atajos de Lanzo Nube' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Contactar soporte' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the Local plan unchanged when working offline and shows no send confirmation', () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    const initialLicense = structuredClone(state.store.licenseDetails);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Vendo desde un equipo/ }));
    fireEvent.click(screen.getByRole('button', { name: /Consultar Lanzo Nube/ }));

    expect(screen.getByRole('dialog')).toHaveTextContent('abrir el chat no confirma su recepción');
    expect(state.store.licenseDetails).toEqual(initialLicense);
    expect(screen.queryByText(/mensaje enviado/i)).not.toBeInTheDocument();
  });
});
