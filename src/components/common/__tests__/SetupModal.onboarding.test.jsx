// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createFreeTrial: vi.fn(), activateLicense: vi.fn(), revalidateLicense: vi.fn(),
  enrollAdminOwnerOnDevice: vi.fn(), adminLoginOnDevice: vi.fn(),
  getBusinessProfile: vi.fn(), saveBusinessProfile: vi.fn(),
  loadData: vi.fn(), saveData: vi.fn(), configureBackup: vi.fn(),
  fetchLegalTerms: vi.fn(), acceptLegalTerms: vi.fn(),
  actorGranted: false, events: [],
  grant: vi.fn(), assertCurrent: vi.fn(),
}));
vi.mock('../../../store/useAppStore', async () => {
  const { create } = await import('zustand');
  return { useAppStore: create(() => ({})) };
});
vi.mock('../../../services/supabase', () => ({
  createFreeTrial: mocks.createFreeTrial, activateLicense: mocks.activateLicense,
  revalidateLicense: mocks.revalidateLicense, enrollAdminOwnerOnDevice: mocks.enrollAdminOwnerOnDevice,
  adminLoginOnDevice: mocks.adminLoginOnDevice, adminLogoutSession: vi.fn(),
  clearAdminSessionCache: vi.fn(), clearStaffSessionCache: vi.fn(),
  getBusinessProfile: mocks.getBusinessProfile, saveBusinessProfile: mocks.saveBusinessProfile,
  fetchLegalTerms: mocks.fetchLegalTerms, acceptLegalTerms: mocks.acceptLegalTerms,
}));
vi.mock('../../../services/database', () => ({
  loadData: mocks.loadData, saveData: mocks.saveData, STORES: { COMPANY: 'company' },
}));
vi.mock('../../../services/licenseStorage', () => ({ saveLicenseToStorage: vi.fn() }));
vi.mock('../../../services/db/databaseRuntime', () => ({ ensureLocalDatabaseReady: vi.fn() }));
vi.mock('../../../services/tenant/localTenantGuard', () => ({
  assertLocalTenantAccess: vi.fn(), assertLocalTenantSyncAccess: vi.fn(),
  initializeLocalTenantGuard: vi.fn(), isLocalTenantAccessError: () => false, lockLocalTenantAccess: vi.fn(),
}));
vi.mock('../../../services/auth/actorSessionRuntimeBridge', () => ({
  beginActorRuntimeAuthentication: () => { mocks.actorGranted = false; },
  grantAuthenticatedActorRuntime: mocks.grant,
  lockActorRuntime: () => { mocks.actorGranted = false; },
}));
vi.mock('../../../services/auth/actorRuntimeController', () => ({
  actorRuntimeController: { capture: () => {
    if (!mocks.actorGranted) throw new Error('ACTOR_CONTEXT_LOCKED');
    return { actorType: 'admin', assertCurrent: mocks.assertCurrent };
  } },
}));
vi.mock('../../../services/storage/imageUploadService', () => ({
  IMAGE_UPLOAD_PURPOSES: { BUSINESS_LOGO: 'business-logo' }, uploadImageFile: vi.fn(),
}));
vi.mock('../../../services/utils', () => ({ compressImage: vi.fn() }));
vi.mock('../../../services/backup/backupManager', () => ({ backupManager: { configure: mocks.configureBackup } }));
vi.mock('../TermsAndConditionsModal', () => ({ default: () => null }));
vi.mock('../LazyImage', () => ({ default: () => null }));

import { useAppStore } from '../../../store/useAppStore';
import { createLicenseActivationActions } from '../../../store/slices/license/licenseActivationActions';
import { createLicenseAdminActions } from '../../../store/slices/license/licenseAdminActions';
import { createProfileSlice } from '../../../store/slices/createProfileSlice';
import SetupModal from '../SetupModal';

// Same reconciliation boundary as App: status changes keep the draft; tenant changes discard it.
function Flow() {
  const status = useAppStore((s) => s.appStatus);
  const license = useAppStore((s) => s.licenseDetails);
  if (['admin_enrollment_required', 'setup_required'].includes(status)) {
    return <SetupModal key={license?.license_key} />;
  }
  return <div>{status}</div>;
}
const business = () => {
  fireEvent.change(screen.getByLabelText('Nombre del Negocio *'), { target: { value: 'Mi negocio' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Abarrotes / Tienda' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
};
const credentials = () => {
  fireEvent.change(screen.getByLabelText('Nombre del propietario'), { target: { value: 'Owner' } });
  fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: 'owner_test' } });
  fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: 'FixturePass123' } });
  fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'FixturePass123' } });
};
const enroll = async () => {
  credentials();
  fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta propietaria' }));
  await screen.findByText('4. Todo listo');
};
const start = async () => {
  await useAppStore.getState().handleFreeTrial();
  render(<Flow />);
};

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mocks.events = [];
  mocks.actorGranted = false;
  mocks.grant.mockImplementation(async () => { mocks.actorGranted = true; mocks.events.push('actor'); });
  mocks.assertCurrent.mockImplementation(() => { if (!mocks.actorGranted) throw new Error('ACTOR_CONTEXT_STALE'); });
  mocks.createFreeTrial.mockResolvedValue({ success: true, details: {
    license_key: 'FREE-ONBOARDING', plan_code: 'free_trial', features: { max_rubros: 1 },
  } });
  mocks.enrollAdminOwnerOnDevice.mockImplementation(async () => {
    mocks.events.push('owner');
    return { success: true, admin_user: { id: 'owner-1' }, details: { license_key: 'FREE-ONBOARDING' } };
  });
  mocks.getBusinessProfile.mockResolvedValue({ code: 'PROFILE_NOT_FOUND' });
  mocks.saveBusinessProfile.mockImplementation(async () => {
    expect(mocks.actorGranted).toBe(true);
    mocks.events.push('profile');
    return { success: true };
  });
  mocks.fetchLegalTerms.mockResolvedValue({ id: 'terms-1' });
  mocks.acceptLegalTerms.mockResolvedValue({ success: true });
  useAppStore.setState({
    appStatus: 'unauthenticated', currentAdminUser: null, currentDeviceRole: null,
    licenseDetails: null, logout: vi.fn(), stopLicenseSync: vi.fn(),
    ...createLicenseActivationActions({ set: useAppStore.setState, get: useAppStore.getState, hasStaffValidationContext: () => false }),
    ...createLicenseAdminActions({ set: useAppStore.setState, get: useAppStore.getState }),
    ...createProfileSlice(useAppStore.setState, useAppStore.getState),
  }, true);
});
afterEach(cleanup);

describe('integrated owner onboarding', () => {
  it.each(['free_trial', 'pro'])('%s saves only after owner enrollment and actor grant, without backup setup', async (plan) => {
    await start();
    act(() => useAppStore.setState({ licenseDetails: { ...useAppStore.getState().licenseDetails, plan_code: plan } }));
    business();
    expect(mocks.saveBusinessProfile).not.toHaveBeenCalled();
    expect(mocks.saveData).not.toHaveBeenCalled();
    expect(screen.queryByText('Respaldo Cifrado')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/PIN de respaldo/)).not.toBeInTheDocument();
    expect(screen.getByText(/No es un PIN de respaldo/)).toBeInTheDocument();
    await enroll();
    expect(mocks.saveBusinessProfile).not.toHaveBeenCalled();
    expect(useAppStore.getState().appStatus).toBe('setup_required');
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar y Empezar' }));
    await screen.findByText('ready');
    expect(mocks.events).toEqual(['owner', 'actor', 'profile']);
    expect(useAppStore.getState().companyProfile.name).toBe('Mi negocio');
    expect(mocks.configureBackup).not.toHaveBeenCalled();
  });

  it('keeps the draft after enrollment rejection and permits a successful retry', async () => {
    mocks.enrollAdminOwnerOnDevice.mockResolvedValueOnce({ success: false, message: 'Error de red' });
    await start(); business(); credentials();
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta propietaria' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Error de red');
    expect(mocks.saveData).not.toHaveBeenCalled();
    expect(mocks.saveBusinessProfile).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Usuario')).toHaveValue('owner_test');
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta propietaria' }));
    await screen.findByText('4. Todo listo');
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar y Empezar' }));
    await screen.findByText('ready');
    expect(mocks.enrollAdminOwnerOnDevice).toHaveBeenCalledTimes(2);
    expect(mocks.events).toEqual(['owner', 'actor', 'profile']);
  });

  it('retries profile failure with the same authenticated owner and draft', async () => {
    mocks.saveBusinessProfile.mockResolvedValueOnce({ success: false, message: 'No se pudo guardar' });
    await start(); business(); await enroll();
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar y Empezar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar');
    expect(useAppStore.getState().currentAdminUser.id).toBe('owner-1');
    expect(mocks.actorGranted).toBe(true);
    expect(screen.queryByLabelText('Confirmar contraseña')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar y Empezar' }));
    await screen.findByText('ready');
    expect(mocks.enrollAdminOwnerOnDevice).toHaveBeenCalledTimes(1);
    expect(mocks.saveBusinessProfile).toHaveBeenCalledTimes(2);
  });

  it('blocks finalization after actor invalidation', async () => {
    await start(); business(); await enroll();
    mocks.actorGranted = false;
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar y Empezar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ACTOR_CONTEXT_LOCKED');
    expect(mocks.saveBusinessProfile).not.toHaveBeenCalled();
  });

  it('does not show owner enrollment for an authenticated owner missing a profile', async () => {
    await start();
    act(() => useAppStore.setState({ appStatus: 'setup_required', currentAdminUser: { id: 'existing' } }));
    mocks.actorGranted = true;
    business();
    expect(screen.queryByLabelText('Confirmar contraseña')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar y Empezar' }));
    await screen.findByText('ready');
    expect(mocks.enrollAdminOwnerOnDevice).not.toHaveBeenCalled();
  });

  it('does not expose enrollment or finalization to Staff even with an inconsistent route', async () => {
    await start();
    act(() => useAppStore.setState({ currentDeviceRole: 'staff', currentStaffUser: { id: 'staff-1' } }));
    business();
    expect(screen.queryByLabelText('Confirmar contraseña')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finalizar y Empezar' })).toBeDisabled();
    expect(mocks.enrollAdminOwnerOnDevice).not.toHaveBeenCalled();
  });

  it('discards the in-memory draft on reload and on license change', async () => {
    await start(); business();
    cleanup(); render(<Flow />);
    expect(screen.getByLabelText('Nombre del Negocio *')).toHaveValue('');
    expect(mocks.actorGranted).toBe(false);
    business();
    act(() => useAppStore.setState({ licenseDetails: { license_key: 'OTHER-LICENSE' } }));
    expect(screen.getByLabelText('Nombre del Negocio *')).toHaveValue('');
    expect(mocks.saveBusinessProfile).not.toHaveBeenCalled();
  });

  it('preserves navigation and enforces license rubro limits on imported configuration', async () => {
    await start();
    act(() => useAppStore.setState({ profileImportCandidate: { name: 'Importado', business_type: ['hardware', 'apparel'] } }));
    fireEvent.click(screen.getByRole('button', { name: 'Copiar datos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Ropa / Calzado' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Atrás' }));
    fireEvent.click(screen.getByRole('button', { name: 'Atrás' }));
    expect(screen.getByLabelText('Nombre del Negocio *')).toHaveValue('Importado');
    expect(mocks.saveBusinessProfile).not.toHaveBeenCalled();
  });

  it('disables navigation while owner enrollment is in flight', async () => {
    let resolve;
    mocks.enrollAdminOwnerOnDevice.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    await start(); business(); credentials();
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta propietaria' }));
    await waitFor(() => expect(mocks.enrollAdminOwnerOnDevice).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Atrás' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /1Tu negocio/ })).toBeDisabled();
    await act(async () => resolve({ success: false, message: 'Reintenta' }));
    expect(screen.getByRole('button', { name: 'Atrás' })).toBeEnabled();
  });
});
