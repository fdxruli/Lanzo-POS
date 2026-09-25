const normalizeCode = (value) => String(value || '').trim().toLowerCase();

const getPlanContext = (licenseDetails = {}) => {
    const planCode = normalizeCode(
        licenseDetails?.plan_code ||
        licenseDetails?.plan ||
        licenseDetails?.subscription_plan ||
        licenseDetails?.product_code
    );
    const licenseType = normalizeCode(licenseDetails?.license_type);
    const isPaidPlan = planCode.includes('pro') || planCode.includes('basic');
    const isFreePlan = !isPaidPlan && (
        planCode === 'free_trial' ||
        planCode.includes('free') ||
        planCode.includes('trial') ||
        licenseType === 'free'
    );
    const isFreeLifetime = isFreePlan && (
        licenseDetails?.is_lifetime === true ||
        licenseDetails?.expires_at === null ||
        licenseDetails?.expires_at === undefined ||
        licenseType === 'free'
    );

    return { isPaidPlan, isFreePlan, isFreeLifetime };
};

const parseDate = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const STATUS_LABELS = {
    active: 'Activa',
    grace_period: 'Período de gracia',
    expired: 'Vencida',
    administratively_blocked: 'Bloqueada por administración',
    blocked: 'Bloqueada',
    revoked: 'Revocada',
    suspended: 'Suspendida',
    disabled: 'Desactivada',
    inactive: 'Inactiva',
    pending: 'Pendiente',
    pending_activation: 'Pendiente de activación',
    locked_renewal: 'Renovación pendiente',
    invalid: 'No válida',
    validation_inconclusive: 'Validación pendiente',
    trial: 'Período de prueba',
    trialing: 'Período de prueba',
    past_due: 'Pago pendiente',
    payment_pending: 'Pago pendiente',
    license_expired: 'Vencida',
    plan_expired: 'Vencida',
    license_not_active: 'Licencia no activa'
};

const DANGER_STATUSES = new Set([
    'administratively_blocked',
    'blocked',
    'revoked',
    'suspended',
    'disabled',
    'invalid',
    'license_not_active'
]);

const WARNING_STATUSES = new Set([
    'grace_period',
    'expired',
    'pending',
    'pending_activation',
    'locked_renewal',
    'validation_inconclusive',
    'past_due',
    'payment_pending'
]);

const formatUnknownStatus = (status) => {
    const words = status.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!words) return 'Sin estado';
    return words.charAt(0).toLocaleUpperCase('es-MX') + words.slice(1);
};

export const getLicenseStatusPresentation = (licenseDetails = {}, now = new Date()) => {
    const sourceStatus = normalizeCode(
        licenseDetails?.lifecycle_state ||
        licenseDetails?.status ||
        licenseDetails?.reason
    );
    const graceEndDate = parseDate(licenseDetails?.grace_period_ends);
    const { isPaidPlan, isFreeLifetime } = getPlanContext(licenseDetails);

    let status = sourceStatus;
    if (isFreeLifetime && (status === 'grace_period' || status === 'expired')) {
        // The plan fields come from the materialized Free license. Ignore stale
        // paid-lifecycle metadata left by an older local session.
        status = 'active';
    } else if (status === 'grace_period' && graceEndDate && graceEndDate <= now) {
        // Do not tell the customer they are still in grace after its end date.
        status = 'expired';
    }

    const label = status === 'expired' && isPaidPlan
        ? 'Cambio a Lanzo Local pendiente'
        : STATUS_LABELS[status] || formatUnknownStatus(status);

    const tone = status === 'active'
        ? 'active'
        : DANGER_STATUSES.has(status)
            ? 'danger'
            : WARNING_STATUSES.has(status)
                ? 'warning'
                : 'neutral';

    return { status: status || 'unknown', label, tone };
};

export const getLicenseExpirationPresentation = (licenseDetails = {}, now = new Date()) => {
    const { isPaidPlan, isFreeLifetime } = getPlanContext(licenseDetails);
    const statusPresentation = getLicenseStatusPresentation(licenseDetails, now);
    const expiryDate = parseDate(licenseDetails?.expires_at);

    if (isFreeLifetime) {
        return { label: 'Permanente', tone: 'success', note: '' };
    }

    if (statusPresentation.status === 'grace_period') {
        const graceEndDate = parseDate(licenseDetails?.grace_period_ends);
        return {
            label: 'Período de gracia',
            tone: 'warning',
            note: graceEndDate
                ? `Lanzo Nube terminó. Puedes seguir operando durante la gracia hasta ${graceEndDate.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}. Después, si no renuevas, se aplicará Lanzo Local.`
                : 'Lanzo Nube terminó. Puedes seguir operando durante la gracia; después, si no renuevas, se aplicará Lanzo Local.'
        };
    }

    if (statusPresentation.status === 'expired' && isPaidPlan) {
        return {
            label: 'Cambio a Lanzo Local pendiente',
            tone: 'warning',
            note: 'El período de gracia terminó. Lanzo está confirmando el cambio a Lanzo Local.'
        };
    }

    if (!licenseDetails?.expires_at) {
        return { label: 'Permanente', tone: 'success', note: '' };
    }

    if (!expiryDate) {
        return { label: 'No disponible', tone: 'neutral', note: '' };
    }

    const formattedDate = expiryDate.toLocaleDateString('es-MX', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    if (expiryDate < now) {
        return {
            label: 'Revisión requerida',
            tone: 'warning',
            note: `Fecha anterior: ${formattedDate}`
        };
    }

    return { label: formattedDate, tone: 'neutral', note: '' };
};
