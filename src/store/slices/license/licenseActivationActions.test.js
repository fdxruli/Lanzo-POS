import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    activateLicense: vi.fn(),
    revalidateLicense: vi.fn(),
    createFreeTrial: vi.fn(),
    saveLicenseToStorage: vi.fn(async () => undefined)
}));

vi.mock('../../../services/supabase', () => ({
    activateLicense: mocks.activateLicense,
    revalidateLicense: mocks.revalidateLicense,
    createFreeTrial: mocks.createFreeTrial
}));

vi.mock('../../../services/licenseStorage', () => ({
    saveLicenseToStorage: mocks.saveLicenseToStorage
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
            message: 'Licencia no encontrada.'
        });

        expect(mocks.saveLicenseToStorage).not.toHaveBeenCalled();
        expect(state._loadProfile).not.toHaveBeenCalled();
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
            adminEnrollmentRequired: true
        });
        expect(state.appStatus).toBe('admin_enrollment_required');
        expect(state.adminEnrollmentRequired).toBe(true);
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
});
