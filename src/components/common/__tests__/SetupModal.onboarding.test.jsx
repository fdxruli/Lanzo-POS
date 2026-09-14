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
import AdminEnrollmentModal from '../AdminEnrollmentModal';

function Flow() {
  const status = useAppStore((state) => state.appStatus);
  const license = useAppStore((state) => state.licenseDetails);
  const ownerEnrollmentContext = useAppStore((state) => state.ownerEnrollmentContext);

  if (status === 'admin_enrollment_required' && ownerEnrollmentContext !== 'new_license_setup') {
    return <AdminEnrollmentModal />;
  }
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

const continueIntegratedOwner = async () => {
  credentials();
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  await screen.findByRole('button', { name: 'Crear negocio' });
};

const submitStandaloneOwnerEnrollment = () => {
  credentials();
  fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta propietaria' }));
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
  mocks.grant.mockImplementation(async () => {
    mocks.actorGranted = true;
    mocks.events.push('actor');
  });
  mocks.assertCurrent.mockImplementation(() => {
    if (!mocks.actorGranted) throw new Error('ACTOR_CONTEXT_STALE');
  });
  mocks.createFreeTrial.mockResolvedValue({
    success: true,
    details: {
      license_key: 'FREE-ONBOARDING',
      plan_code: 'free_trial',
      features: { max_rubros: 1 },
    }
  });
  mocks.enrollAdminOwnerOnDevice.mockImplementation(async ({ licenseKey }) => {
    mocks.events.push('owner');
    return { success: true, admin_user: { id: 'owner-1' }, details: { license_key: licenseKey } };
  });
  mocks.getBusinessProfile.mockResolvedValue({ code: 'PROFILE_NOT_FOUND' });
  mocks.saveBusinessProfile.mockImplementation(async () => {
    expect(mocks.actorGranted).toBe(true);
    mocks.events.push('profile');
    return { success: true };
  });
  mocks.fetchLegalTerms.mockResolvedValue({ id: 'terms-1' });
  mocks.acceptLegalTerms.mockImplementation(async () => {
    mocks.events.push('terms');
    return { success: true };
  });

  useAppStore.setState({
    appStatus: 'unauthenticated',
    currentAdminUser: null,
    currentDeviceRole: null,
    licenseDetails: null,
    logout: vi.fn(),
    stopLicenseSync: vi.fn(),
    ...createLicenseActivationActions({
      set: useAppStore.setState,
      get: useAppStore.getState,
      hasStaffValidationContext: () => false
    }),
    ...createLicenseAdminActions({ set: useAppStore.setState, get: useAppStore.getState }),
    ...createProfileSlice(useAppStore.setState, useAppStore.getState),
  }, true);

  mocks.revalidateLicense.mockImplementation(async (licenseKey) => {
    const currentLicense = useAppStore.getState().licenseDetails || {};
    const features = currentLicense.features || { max_rubros: 1 };
    return {
      valid: true,
      license_key: licenseKey,
      plan_code: currentLicense.plan_code,
      features,
      details: { ...currentLicense, license_key: licenseKey, features },
    };
  });
});

afterEach(cleanup);

describe('integrated owner onboarding', () => {
  it.each(['free_trial', 'pro'])('%s uses an explicit review step before legal acceptance and profile persistence', async (plan) => {
    await start();
    act(() => useAppStore.setState({
      licenseDetails: { ...useAppStore.getState().licenseDetails, plan_code: plan }
    }));

    business();

    expect(mocks.saveBusinessProfile).not.toHaveBeenCalled();
    expect(mocks.acceptLegalTerms).not.toHaveBeenCalled();
    expect(screen.queryByText('Respaldo Cifrado')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/PIN de respaldo/)).not.toBeInTheDocument();
    expect(screen.getByText(/No es un PIN de respaldo/)).toBeInTheDocument();
    expect(screen.queryByText(/Al hacer clic en Crear negocio/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Atrás' })).not.toBeInTheDocument();

    await continueIntegratedOwner();

    expect(useAppStore.getState().appStatus).toBe('setup_required');
    expect(useAppStore.getState().ownerEnrollmentContext).toBe('new_license_setup');
    expect(mocks.saveBusinessProfile).not.toHaveBeenCalled();
    expect(mocks.acceptLegalTerms).not.toHaveBeenCalled();
    expect(screen.getByText('Mi negocio')).toBeInTheDocument();
    expect(screen.getByText('Abarrotes / Tienda')).toBeInTheDocument();
    expect(screen.getByText('Propietario creado')).toBeInTheDocument();
    expect(screen.getByText(/Al hacer clic en/)).toHaveTextContent('Crear negocio');
    expect(screen.getByRole('button', { name: 'Términos y Condiciones' })).toBeInTheDocument();

    const changeLicense = screen.getByRole('button', { name: 'Cambiar licencia' });
    expect(changeLicense.closest('.accordion-item')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Crear negocio' }));
    await screen.findByText('ready');

    expect(mocks.events).toEqual(['owner', 'actor', 'terms', 'profile']);
    expect(useAppStore.getState().companyProfile.name).toBe('Mi negocio');
    expect(useAppStore.getState().ownerEnrollmentContext).toBeNull();
    expect(mocks.configureBackup).not.toHaveBeenCalled();
  });

  it('keeps the draft after enrollment rejection and permits a successful retry', async () => {
    mocks.enrollAdminOwnerOnDevice.mockResolvedValueOnce({ success: false, message: 'Error de red' });
    await start();
    business();
    credentials();

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Error de red');
    expect(mocks.saveData).not.toHaveBeenCalled();
    expect(mocks.saveBusinessProfile).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Usuario')).toHaveValue('owner_test');

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByRole('button', { name: 'Crear negocio' });
    fireEvent.click(screen.getByRole('button', { name: 'Crear negocio' }));
    await screen.findByText('ready');

    expect(mocks.enrollAdminOwnerOnDevice).toHaveBeenCalledTimes(2);
    expect(mocks.events).toEqual(['owner', 'actor', 'terms', 'profile']);
  });

  it('retries profile failure with the same authenticated owner and draft', async () => {
    mocks.saveBusinessProfile.mockResolvedValueOnce({ success: false, message: 'No se pudo guardar' });
    await start();
    business();
    await continueIntegratedOwner();

    fireEvent.click(screen.getByRole('button', { name: 'Crear negocio' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar');
    expect(useAppStore.getState().currentAdminUser.id).toBe('owner-1');
    expect(mocks.actorGranted).toBe(true);
    expect(screen.queryByLabelText('Confirmar contraseña')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Crear negocio' }));
    await screen.findByText('ready');

    expect(mocks.enrollAdminOwnerOnDevice).toHaveBeenCalledTimes(1);
    expect(mocks.saveBusinessProfile).toHaveBeenCalledTimes(2);
  });

  it('does not save the business when legal acceptance fails and can retry safely', async () => {
    mocks.acceptLegalTerms.mockResolvedValueOnce({ success: false, message: 'LEGAL_ACCEPT_FAILED' });
    await start();
    business();
    await continueIntegratedOwner();

    fireEvent.click(screen.getByRole('button', { name: 'Crear negocio' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Error registrando la aceptacion de terminos.');
    expect(mocks.saveBusinessProfile).not.toHaveBeenCalled();
    expect(useAppStore.getState().currentAdminUser.id).toBe('owner-1');

    fireEvent.click(screen.getByRole('button', { name: 'Crear negocio' }));
    await screen.findByText('ready');

    expect(mocks.enrollAdminOwnerOnDevice).toHaveBeenCalledTimes(1);
    expect(mocks.saveBusinessProfile).toHaveBeenCalledTimes(1);
  });

  it('blocks finalization after actor invalidation', async () => {
    await start();
    business();
    await continueIntegratedOwner();
    mocks.actorGranted = false;

    fireEvent.click(screen.getByRole('button', { name: 'Crear negocio' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ACTOR_CONTEXT_LOCKED');
    expect(mocks.acceptLegalTerms).not.toHaveBeenCalled();
    expect(mocks.saveBusinessProfile).not.toHaveBeenCalled();
  });

  it('skips owner enrollment for an authenticated owner missing a profile', async () => {
    await start();
    act(() => useAppStore.setState({
      appStatus: 'setup_required',
      currentAdminUser: { id: 'existing' },
      currentDeviceRole: 'admin'
    }));
    mocks.actorGranted = true;

    business();

    expect(screen.queryByLabelText('Confirmar contraseña')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear negocio' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Crear negocio' }));
    await screen.findByText('ready');
    expect(mocks.enrollAdminOwnerOnDevice).not.toHaveBeenCalled();
  });

  it('routes an existing license with a profile through standalone enrollment without rewriting it', async () => {
    mocks.activateLicense.mockResolvedValue({
      valid: false,
      admin_enrollment_required: true,
      details: { license_key: 'EXISTING-WITH-PROFILE', plan_code: 'pro', features: { max_rubros: 2 } }
    });
    mocks.getBusinessProfile.mockResolvedValue({
      success: true,
      data: {
        license_key: 'EXISTING-WITH-PROFILE',
        business_name: 'Negocio existente',
        business_type: ['abarrotes']
      }
    });

    await useAppStore.getState().handleLogin('EXISTING-WITH-PROFILE');
    render(<Flow />);

    expect(useAppStore.getState().ownerEnrollmentContext).toBe('existing_license');
    expect(screen.getByRole('heading', { name: 'Tu acceso como propietario' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Nombre del Negocio *')).not.toBeInTheDocument();
    expect(screen.queryByText('Giro del Negocio')).not.toBeInTheDocument();

    submitStandaloneOwnerEnrollment();
    await screen.findByText('ready');

    expect(mocks.enrollAdminOwnerOnDevice).toHaveBeenCalledWith(expect.objectContaining({
      licenseKey: 'EXISTING-WITH-PROFILE'
    }));
    expect(mocks.events).toEqual(['owner', 'actor']);
    expect(mocks.saveBusinessProfile).not.toHaveBeenCalled();
    expect(useAppStore.getState().companyProfile).toMatchObject({ name: 'Negocio existente' });
    expect(useAppStore.getState().ownerEnrollmentContext).toBeNull();
  });

  it('routes an existing license without a profile to the final setup review after one enrollment', async () => {
    mocks.activateLicense.mockResolvedValue({
      valid: false,
      admin_enrollment_required: true,
      details: { license_key: 'EXISTING-WITHOUT-PROFILE', plan_code: 'pro', features: { max_rubros: 2 } }
    });
    mocks.getBusinessProfile.mockResolvedValue({ code: 'PROFILE_NOT_FOUND' });

    await useAppStore.getState().handleLogin('EXISTING-WITHOUT-PROFILE');
    render(<Flow />);

    expect(useAppStore.getState().ownerEnrollmentContext).toBe('existing_license');
    submitStandaloneOwnerEnrollment();
    await screen.findByLabelText('Nombre del Negocio *');
    expect(mocks.events).toEqual(['owner', 'actor']);

    business();
    expect(screen.getByRole('button', { name: 'Crear negocio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /3Todo listo/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Crear negocio' }));
    await screen.findByText('ready');

    expect(mocks.enrollAdminOwnerOnDevice).toHaveBeenCalledTimes(1);
    expect(mocks.events).toEqual(['owner', 'actor', 'terms', 'profile']);
    expect(mocks.saveBusinessProfile).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().ownerEnrollmentContext).toBeNull();
  });

  it('does not expose enrollment or business creation to Staff even with an inconsistent route', async () => {
    await start();
    act(() => useAppStore.setState({ currentDeviceRole: 'staff', currentStaffUser: { id: 'staff-1' } }));
    business();

    expect(screen.queryByLabelText('Confirmar contraseña')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear negocio' })).not.toBeInTheDocument();
    expect(mocks.enrollAdminOwnerOnDevice).not.toHaveBeenCalled();
  });

  it('discards the in-memory draft on reload and on license change', async () => {
    await start();
    business();
    cleanup();
    render(<Flow />);

    expect(screen.getByLabelText('Nombre del Negocio *')).toHaveValue('');
    expect(mocks.actorGranted).toBe(false);

    business();
    act(() => useAppStore.setState({ licenseDetails: { license_key: 'OTHER-LICENSE' } }));
    expect(screen.getByLabelText('Nombre del Negocio *')).toHaveValue('');
    expect(mocks.saveBusinessProfile).not.toHaveBeenCalled();
  });

  it('uses completed accordion headers for backward navigation instead of Atrás buttons', async () => {
    await start();
    act(() => useAppStore.setState({
      profileImportCandidate: { name: 'Importado', business_type: ['hardware', 'apparel'] }
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Copiar datos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Ropa / Calzado' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(screen.queryByRole('button', { name: 'Atrás' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /2Giro del Negocio/ }));
    fireEvent.click(screen.getByRole('button', { name: /1Tu negocio/ }));
    expect(screen.getByLabelText('Nombre del Negocio *')).toHaveValue('Importado');
    expect(mocks.saveBusinessProfile).not.toHaveBeenCalled();
  });

  it('disables accordion navigation and the external license action while owner enrollment is in flight', async () => {
    let resolve;
    mocks.enrollAdminOwnerOnDevice.mockReturnValueOnce(new Promise((resolver) => { resolve = resolver; }));
    await start();
    business();
    credentials();

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(mocks.enrollAdminOwnerOnDevice).toHaveBeenCalled());

    expect(screen.queryByRole('button', { name: 'Atrás' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1Tu negocio/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /2Giro del Negocio/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cambiar licencia' })).toBeDisabled();

    await act(async () => resolve({ success: false, message: 'Reintenta' }));
    expect(screen.getByRole('button', { name: 'Cambiar licencia' })).toBeEnabled();
  });
});
