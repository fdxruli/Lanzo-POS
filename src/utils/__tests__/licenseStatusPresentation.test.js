import { describe, expect, it } from 'vitest';
import {
    getLicenseExpirationPresentation,
    getLicenseStatusPresentation
} from '../licenseStatusPresentation';

const CURRENT_TIME = new Date('2026-09-25T02:12:00.000Z');

describe('license status presentation', () => {
    it('shows a materialized permanent Free plan as active when cached Pro grace data is stale', () => {
        const license = {
            plan_code: 'free_trial',
            license_type: 'free',
            is_lifetime: true,
            status: 'grace_period',
            lifecycle_state: 'grace_period',
            expires_at: null,
            grace_period_ends: '2026-09-24T02:56:31.721Z'
        };

        expect(getLicenseStatusPresentation(license, CURRENT_TIME)).toMatchObject({
            status: 'active',
            label: 'Activa',
            tone: 'active'
        });
        expect(getLicenseExpirationPresentation(license, CURRENT_TIME)).toEqual({
            label: 'Permanente',
            tone: 'success',
            note: ''
        });
    });

    it('shows a paid plan past its grace deadline as awaiting the Local transition', () => {
        const license = {
            plan_code: 'pro_monthly',
            status: 'grace_period',
            expires_at: '2026-09-17T02:56:31.721Z',
            grace_period_ends: '2026-09-24T02:56:31.721Z'
        };

        expect(getLicenseStatusPresentation(license, CURRENT_TIME)).toMatchObject({
            status: 'expired',
            label: 'Cambio a Lanzo Local pendiente',
            tone: 'warning'
        });
        expect(getLicenseExpirationPresentation(license, CURRENT_TIME)).toMatchObject({
            label: 'Cambio a Lanzo Local pendiente',
            tone: 'warning',
            note: 'El período de gracia terminó. Lanzo está confirmando el cambio a Lanzo Local.'
        });
    });

    it('translates lifecycle and administrative statuses to Spanish', () => {
        expect(getLicenseStatusPresentation({ status: 'grace_period' }).label).toBe('Período de gracia');
        expect(getLicenseStatusPresentation({ status: 'administratively_blocked' }).label)
            .toBe('Bloqueada por administración');
        expect(getLicenseStatusPresentation({ status: 'revoked' }).label).toBe('Revocada');
    });

    it('humanizes unknown status codes without exposing underscores', () => {
        expect(getLicenseStatusPresentation({ status: 'custom_review_state' }).label)
            .toBe('Custom review state');
    });
});
