import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    activateLicense: vi.fn(),
    revalidateLicense: vi.fn(),
    createFreeTrial: vi.fn(),
    saveLicenseToStorage: vi.fn(async () => undefined),
    isLocalTenantAccessError: vi.fn(() => false),
    enterLocalTenantIsolationFailure: vi.fn()
}));

vi.mock('../../../services/supabase', () => ({
    activateLicense: mocks.activateLicense,
    revalidateLicense: mocks.revalidateLicense,
    createFreeTrial: mocks.createFreeTrial
}));

vi.mock('../../../services/licenseStorage', () => ({
    saveLicenseToStorage: mocks.saveLicenseToStorage
}));

vi.mock('../../../services/tenant/localTenantGuard', () => ({
    assertLocalTenantAccess: vi.fn(async () => ({ status: 'pass' })),
    assertLocalTenantSyncAccess: vi.fn(async () => ({ status: 'pass' })),
    initializeLocalTenantGuard: vi.fn(),
    isLocalTenantAccessError: mocks.isLocalTenantAccessError,
}));

vi.mock('./localTenantIsolationState', () => ({
    enterLocalTenantIsolationFailure: mocks.enterLocalTenantIsolationFailure
}));

import { createLicenseActivationActions } from './licenseActivationActions';

const createActionState = (profileStatus = 'ready') => {
    const state = {
        appStatus: 'unauthenticated',
        currentDeviceRole: 'admin',
        currentStaffUser: { id: 'previous-staff-user' },
        _requireLicenseChange: vi.fn(),
        _loadProfile: vi.fn(async () => {
            state.appStatus = profileStatus;
        })
    };
    const set = vi.fn((partial) => Object.assign(state, partial));
    const get = () => state;

    Object.assign(state, createLicenseActivationActions({
        set,
        get,
        hasStaffValidationContext: () => false
    }));

    return { state, set };
};

describe('createLicenseActivationActions.handleLogin', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isLocalTenantAccessError.mockReturnValue(false);
        mocks.revalidateLicense.mockResolvedValue({ valid: false });
    });

    it('completes a valid admin activation instead of returning its success message as an error', async () => {
        const { state } = createActionState();
        mocks.activateLicense.mockResolvedValue({
            valid: true,
            message: 'Licencia activada correctamente',
            details: {
                license_key: 'LANZO-TEST-ADMIN',
                device_role: 'admin',
                features: {},
                product_name: 'Lanzo POS Pro'
            }
        });

        await expect(state.handleLogin('LANZO-TEST-ADMIN')).resolves.toEqual({ success: true });

        expect(mocks.saveLicenseToStorage).toHaveBeenCalledWith(expect.objectContaining({
            license_key: 'LANZO-TEST-ADMIN',
            valid: true
        }));
        expect(state.licenseDetails).toMatchObject({
            license_key: 'LANZO-TEST-ADMIN',
            device_role: 'admin',
            valid: true
        });
        expect(state.currentDeviceRole).toBe('admin');
        expect(state.currentStaffUser).toBeNull();
        expect(state._loadProfile).toHaveBeenCalledWith('LANZO-TEST-ADMIN', {
            forceRemote: true,
            reason: 'activation'
        });
        expect(state.appStatus).toBe('ready');
    });

    it('allows the profile loader to select setup_required when an admin profile is absent', async () => {
        const { state } = createActionState('setup_required');
        mocks.activateLicense.mockResolvedValue({
            valid: true,
            details: {
                license_key: 'LANZO-TEST-SETUP',
                device_role: 'admin',
                features: {}
            }
        });

        await expect(state.handleLogin('LANZO-TEST-SETUP')).resolves.toEqual({ success: true });

        expect(state._loadProfile).toHaveBeenCalledTimes(1);
        expect(state.appStatus).toBe('setup_required');
    });

    it('keeps invalid activation responses as errors', async () => {
        const { state } = createActionState();
        mocks.activateLicense.mockResolvedValue({
            valid: false,
            code: 'LICENSE_NOT_FOUND',
            message: 'Licencia no encontrada.'
        });

        await expect(state.handleLogin('LANZO-TEST-MISSING')).resolves.toEqual({
            success: false,
            code: 'LICENSE_NOT_FOUND',
            message: 'Licencia no encontrada.'
        });

        expect(mocks.saveLicenseToStorage).not.toHaveBeenCalled();
        expect(state._loadProfile).not.toHaveBeenCalled();
    });

    it('preserves the code for an inactive license', async () => {
        const { state } = createActionState();
        mocks.activateLicense.mockResolvedValue({
            valid: false,
            code: 'LICENSE_NOT_ACTIVE',
            message: 'Licencia no activa.'
        });

        await expect(state.handleLogin('LANZO-TEST-INACTIVE')).resolves.toEqual({
            success: false,
            code: 'LICENSE_NOT_ACTIVE',
            message: 'Licencia no activa.'
        });
    });

    it('preserves the rate-limit code and retry metadata', async () => {
        const { state } = createActionState();
        mocks.activateLicense.mockResolvedValue({
            valid: false,
            code: 'LICENSE_ACTIVATION_RATE_LIMITED',
            message: 'Demasiados intentos.',
            retry_after_seconds: 300
        });

        await expect(state.handleLogin('LANZO-TEST-RATE-LIMITED')).resolves.toEqual({
            success: false,
            code: 'LICENSE_ACTIVATION_RATE_LIMITED',
            message: 'Demasiados intentos.',
            retry_after_seconds: 300
        });
    });

    it('returns a typed actionable browser-storage failure without finalizing local login', async () => {
        const { state } = createActionState();
        const error = new Error('native IndexedDB failure');
        error.code = 'DB_BROWSER_STORAGE_UNAVAILABLE';
        error.name = 'BrowserStorageUnavailableError';
        error.message = 'No se pudo abrir el almacenamiento local del navegador.';
        mocks.activateLicense.mockRejectedValueOnce(error);

        await expect(state.handleLogin('LANZO-TEST-IDB-FAILURE')).resolves.toEqual({
            success: false,
            code: 'DB_BROWSER_STORAGE_UNAVAILABLE',
            message: 'No se pudo abrir el almacenamiento local del navegador.'
        });
        expect(mocks.saveLicenseToStorage).not.toHaveBeenCalled();
        expect(state._loadProfile).not.toHaveBeenCalled();
    });

    it('preserves a typed database-open timeout without exposing it in routing state', async () => {
        const { state } = createActionState();
        const error = new Error('IndexedDB capability probe timed out after 3000ms.');
        error.name = 'DatabaseOpenTimeoutError';
        error.code = 'DB_OPEN_TIMEOUT';
        mocks.activateLicense.mockRejectedValueOnce(error);

        await expect(state.handleLogin('LANZO-TEST-IDB-TIMEOUT')).resolves.toEqual({
            success: false,
            code: 'DB_OPEN_TIMEOUT',
            message: 'IndexedDB capability probe timed out after 3000ms.'
        });
    });

    it('preserves the staff-login-required transition', async () => {
        const { state } = createActionState();
        mocks.activateLicense.mockResolvedValue({
            valid: false,
            code: 'STAFF_LOGIN_REQUIRED',
            staff_login_required: true,
            message: 'Este dispositivo requiere login staff.',
            details: { license_key: 'LANZO-TEST-STAFF-LOGIN' }
        });

        await expect(state.handleLogin('LANZO-TEST-STAFF-LOGIN')).resolves.toMatchObject({
            success: false,
            code: 'STAFF_LOGIN_REQUIRED',
            staffLoginRequired: true
        });

        expect(state.appStatus).toBe('staff_login_required');
        expect(state.currentDeviceRole).toBe('staff');
        expect(state.currentStaffUser).toBeNull();
    });

    it('opens the Admin/Staff chooser without treating it as an activation error', async () => {
        const { state } = createActionState();
        mocks.activateLicense.mockResolvedValue({
            valid: false,
            code: 'ADMIN_OR_STAFF_LOGIN_REQUIRED',
            access_choice_required: true,
            message: 'Elige como deseas ingresar.',
            details: { product_name: 'Lanzo Pro' }
        });

        await expect(state.handleLogin('LANZO-TEST-CHOOSER')).resolves.toEqual({
            success: false,
            code: 'ADMIN_OR_STAFF_LOGIN_REQUIRED',
            message: 'Elige como deseas ingresar.',
            accessChoiceRequired: true
        });
        expect(state.appStatus).toBe('license_access_required');
        expect(state.adminLoginLicenseKey).toBe('LANZO-TEST-CHOOSER');
        expect(state.staffLoginLicenseKey).toBe('LANZO-TEST-CHOOSER');
    });

    it('requires owner enrollment on the trusted legacy admin device', async () => {
        const { state } = createActionState();
        mocks.activateLicense.mockResolvedValue({
            valid: false,
            code: 'ADMIN_ENROLLMENT_REQUIRED',
            admin_enrollment_required: true,
            message: 'Crea las credenciales del propietario.',
            details: { device_role: 'admin' }
        });

        await expect(state.handleLogin('LANZO-TEST-ENROLL')).resolves.toEqual({
            success: false,
            code: 'ADMIN_ENROLLMENT_REQUIRED',
            message: 'Crea las credenciales del propietario.',
            adminEnrollmentRequired: true
        });
        expect(state.appStatus).toBe('admin_enrollment_required');
        expect(state.adminEnrollmentRequired).toBe(true);
    });

    it('preserves the dedicated license-change transition', async () => {
        const { state } = createActionState();
        mocks.activateLicense.mockResolvedValue({
            valid: false,
            code: 'PLAN_DOWNGRADE_DEVICE_LIMIT',
            block_reason: 'PLAN_DOWNGRADE_DEVICE_LIMIT',
            message: 'Esta licencia ya no puede usarse en este dispositivo.'
        });

        await expect(state.handleLogin('LANZO-TEST-PLAN-BLOCK')).resolves.toEqual({
            success: false,
            code: 'PLAN_DOWNGRADE_DEVICE_LIMIT',
            message: 'Esta licencia ya no puede usarse en este dispositivo.',
            licenseChangeRequired: true
        });
        expect(state._requireLicenseChange).toHaveBeenCalledTimes(1);
    });

    it('preserves the local-tenant mismatch transition', async () => {
        const { state } = createActionState();
        const error = new Error('The local tenant belongs to another license.');
        error.code = 'LOCAL_TENANT_MISMATCH';
        mocks.isLocalTenantAccessError.mockReturnValueOnce(true);
        mocks.activateLicense.mockRejectedValueOnce(error);

        await expect(state.handleLogin('LANZO-TEST-TENANT-MISMATCH')).resolves.toEqual({
            success: false,
            code: 'LOCAL_TENANT_MISMATCH',
            message: 'The local tenant belongs to another license.',
            localTenantMismatch: true
        });
        expect(mocks.enterLocalTenantIsolationFailure).toHaveBeenCalledWith(expect.any(Function), error);
    });

    it('keeps a valid staff activation scoped to the staff role', async () => {
        const { state } = createActionState();
        mocks.activateLicense.mockResolvedValue({
            valid: true,
            details: {
                license_key: 'LANZO-TEST-STAFF',
                device_role: 'staff',
                staff_user: { id: 'staff-test', permissions: { sales: true } },
                features: { staff_roles: true }
            }
        });

        await expect(state.handleLogin('LANZO-TEST-STAFF')).resolves.toEqual({ success: true });

        expect(state.currentDeviceRole).toBe('staff');
        expect(state.currentStaffUser).toEqual({ id: 'staff-test', permissions: { sales: true } });
        expect(state._loadProfile).toHaveBeenCalledWith('LANZO-TEST-STAFF', {
            forceRemote: true,
            reason: 'activation'
        });
    });

    it('routes a new free trial through real Admin enrollment before Setup', async () => {
        const { state } = createActionState('setup_required');
        mocks.createFreeTrial.mockResolvedValue({
            success: true,
            details: {
                license_key: 'LANZO-FREE-ACTOR',
                plan_code: 'free_trial',
                product_name: 'Lanzo Local',
                max_devices: 1,
                features: { staff_roles: false }
            }
        });

        await expect(state.handleFreeTrial()).resolves.toEqual({
            success: true,
            adminEnrollmentRequired: true
        });

        expect(mocks.saveLicenseToStorage).toHaveBeenCalledWith(expect.objectContaining({
            license_key: 'LANZO-FREE-ACTOR',
            valid: true
        }));
        expect(state).toMatchObject({
            appStatus: 'admin_enrollment_required',
            currentDeviceRole: 'admin',
            currentAdminUser: null,
            currentStaffUser: null,
            adminLoginLicenseKey: 'LANZO-FREE-ACTOR',
            adminEnrollmentRequired: true
        });
        expect(state.licenseDetails).toMatchObject({
            license_key: 'LANZO-FREE-ACTOR',
            plan_code: 'free_trial',
            valid: false,
            device_role: 'admin'
        });
        expect(state._loadProfile).not.toHaveBeenCalled();
    });

    it('preserves a typed browser-storage failure from free-license creation', async () => {
        const { state } = createActionState();
        const error = new Error('No se pudo abrir el almacenamiento local del navegador.');
        error.name = 'BrowserStorageUnavailableError';
        error.code = 'DB_BROWSER_STORAGE_UNAVAILABLE';
        mocks.createFreeTrial.mockRejectedValueOnce(error);

        await expect(state.handleFreeTrial()).resolves.toEqual({
            success: false,
            code: 'DB_BROWSER_STORAGE_UNAVAILABLE',
            message: 'No se pudo abrir el almacenamiento local del navegador.'
        });
        expect(mocks.saveLicenseToStorage).not.toHaveBeenCalled();
    });
});
