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
    unknown: 'Por confirmar',
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

const BLOCKING_LIFECYCLE_STATES = new Set([
    'administratively_blocked',
    'blocked',
    'revoked',
    'suspended',
    'disabled',
    'inactive',
    'invalid',
    'license_not_active',
    'license_plan_blocked',
    'device_banned',
    'device_not_allowed'
]);

const EFFECTIVE_LIFECYCLE_STATES = new Set(['active', 'grace_period', 'expired']);
const UNCERTAIN_LIFECYCLE_STATES = new Set([
    'pending',
    'pending_activation',
    'locked_renewal',
    'validation_inconclusive',
    'past_due',
    'payment_pending'
]);

const normalizeLifecycleState = (value) => {
    const status = normalizeCode(value);
    if (['license_expired', 'plan_expired', 'expired_subscription'].includes(status)) return 'expired';
    return status;
};

const resolveGraceBoundary = (gracePeriodEnds, now) => {
    const graceEndDate = parseDate(gracePeriodEnds);
    if (!graceEndDate) return 'unknown';
    return graceEndDate <= now ? 'expired' : 'grace_period';
};

export const createEffectiveLicenseValidationEvidence = (
    validationData = {},
    { effectiveStatus, now = new Date() } = {}
) => {
    if (
        !validationData ||
        typeof validationData !== 'object' ||
        validationData.is_fallback === true
    ) {
        return null;
    }

    const status = normalizeLifecycleState(
        effectiveStatus ||
        validationData.lifecycle_state ||
        validationData.status ||
        validationData.reason
    );
    const validatedAt = now instanceof Date ? now : new Date(now);

    if (!status || Number.isNaN(validatedAt.getTime())) return null;

    return Object.freeze({
        source: 'server_validation',
        status,
        valid: typeof validationData.valid === 'boolean' ? validationData.valid : null,
        is_entitled: typeof validationData.is_entitled === 'boolean'
            ? validationData.is_entitled
            : null,
        is_in_grace: typeof validationData.is_in_grace === 'boolean'
            ? validationData.is_in_grace
            : status === 'grace_period' ? true : null,
        expires_at: typeof validationData.expires_at === 'string'
            ? validationData.expires_at
            : null,
        grace_period_ends: typeof validationData.grace_period_ends === 'string'
            ? validationData.grace_period_ends
            : null,
        validated_at: validatedAt.toISOString()
    });
};

export const resolveEffectiveLicenseLifecycle = (
    licenseDetails = {},
    { licenseStatus, now = new Date() } = {}
) => {
    const currentTime = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(currentTime.getTime())) return 'unknown';

    const details = licenseDetails && typeof licenseDetails === 'object' ? licenseDetails : {};
    const evidence = details.effective_lifecycle_validation;
    const adminStatus = normalizeLifecycleState(details.license_status);
    const evidenceStatus = normalizeLifecycleState(evidence?.status);
    const detailLifecycleState = normalizeLifecycleState(details.lifecycle_state);
    const detailStatus = normalizeLifecycleState(details.status);
    const storeStatus = normalizeLifecycleState(licenseStatus);

    const statusSignals = [evidenceStatus, detailLifecycleState, detailStatus, storeStatus]
        .filter(Boolean);
    const blockingStatus = statusSignals.find((status) => BLOCKING_LIFECYCLE_STATES.has(status));
    if (blockingStatus) return blockingStatus;

    // license_status is administrative metadata; it must not replace the
    // effective lifecycle returned by server validation.
    if (adminStatus && BLOCKING_LIFECYCLE_STATES.has(adminStatus)) {
        return adminStatus;
    }

    if (
        statusSignals.some((status) => UNCERTAIN_LIFECYCLE_STATES.has(status))
    ) {
        return statusSignals.find((status) => UNCERTAIN_LIFECYCLE_STATES.has(status));
    }

    const { isFreeLifetime } = getPlanContext(details);
    if (
        isFreeLifetime &&
        [evidenceStatus, detailLifecycleState, detailStatus].some(
            (status) => status === 'grace_period' || status === 'expired'
        )
    ) {
        return 'active';
    }

    if (evidence !== undefined && evidence !== null) {
        const validatedAt = parseDate(evidence.validated_at);
        if (
            evidence.source !== 'server_validation' ||
            !validatedAt ||
            validatedAt > currentTime ||
            !evidenceStatus
        ) {
            return 'unknown';
        }

        if (evidenceStatus === 'active') {
            if (
                evidence.valid !== true ||
                evidence.is_entitled === false ||
                evidence.is_in_grace === true
            ) {
                return 'unknown';
            }

            const expiryDate = parseDate(evidence.expires_at);
            if (evidence.expires_at && !expiryDate) return 'unknown';
            if (expiryDate && expiryDate <= currentTime) return 'unknown';
            return 'active';
        }

        if (evidenceStatus === 'grace_period') {
            if (
                evidence.valid !== true ||
                evidence.is_entitled === false ||
                evidence.is_in_grace === false
            ) {
                return 'unknown';
            }

            return resolveGraceBoundary(evidence.grace_period_ends, currentTime);
        }

        if (evidenceStatus === 'expired') {
            return evidence.valid === false &&
                evidence.is_entitled !== true &&
                evidence.is_in_grace !== true
                ? 'expired'
                : 'unknown';
        }

        return STATUS_LABELS[evidenceStatus] ? evidenceStatus : 'unknown';
    }

    if (
        details.valid === true &&
        details.is_entitled === true &&
        details.is_in_grace === true
    ) {
        return resolveGraceBoundary(details.grace_period_ends, currentTime);
    }

    const signals = [detailLifecycleState, detailStatus, storeStatus].filter(Boolean);
    if (signals.length === 0) return 'unknown';

    const unknownSignal = signals.find((status) => (
        !EFFECTIVE_LIFECYCLE_STATES.has(status) &&
        !STATUS_LABELS[status]
    ));
    if (unknownSignal) return 'unknown';

    const effectiveSignals = signals.filter((status) => EFFECTIVE_LIFECYCLE_STATES.has(status));
    const distinctStates = new Set(effectiveSignals);
    if (distinctStates.size > 1) return 'unknown';

    const status = effectiveSignals[0] || signals[0];
    if (status === 'grace_period') {
        if (
            details.valid !== true ||
            details.is_entitled !== true ||
            details.is_in_grace !== true
        ) {
            return 'unknown';
        }

        return resolveGraceBoundary(details.grace_period_ends, currentTime);
    }

    if (status === 'active') {
        if (
            details.valid !== true ||
            details.is_entitled === false ||
            details.is_in_grace === true
        ) {
            return 'unknown';
        }

        const expiryDate = parseDate(details.expires_at);
        if (expiryDate && expiryDate <= currentTime) return 'unknown';
        return 'active';
    }

    if (status === 'expired') {
        return details.valid === false &&
            details.is_entitled !== true &&
            details.is_in_grace !== true
            ? 'expired'
            : 'unknown';
    }

    return status || 'unknown';
};

export const getLicenseStatusPresentation = (
    licenseDetails = {},
    now = new Date(),
    { licenseStatus } = {}
) => {
    const status = resolveEffectiveLicenseLifecycle(licenseDetails, { licenseStatus, now });
    const { isPaidPlan } = getPlanContext(licenseDetails);

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

export const getLicenseExpirationPresentation = (licenseDetails = {}, now = new Date(), options = {}) => {
    const { isPaidPlan, isFreeLifetime } = getPlanContext(licenseDetails);
    const statusPresentation = getLicenseStatusPresentation(licenseDetails, now, options);
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
