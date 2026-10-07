// src/store/slices/license/licenseBackgroundValidationActions.js

import { checkInternetConnection, showMessageModal } from '../../../services/utils';
import Logger from '../../../services/Logger';

import {
  revalidateLicense
} from '../../../services/supabase';

import {
  saveLicenseToStorage,
  getLicenseFromStorage
} from '../../../services/licenseStorage';

import {
  getLicenseSyncMode,
  normalizeValidationCode,
  isFatalValidationFailure,
  isStaffDeviceAuthorizationFailure,
  isLicensePlanBlockFailure
} from './licenseGuards';

import {
  markLastLicenseValidationAttempt,
  markLastLicenseValidationSuccess,
  shouldSkipRemoteValidationForPlan,
  shouldSkipRemoteValidationAfterFailure
} from './licenseValidationTimestamps';

export const createLicenseBackgroundValidationActions = ({
  set,
  get,
  clearLocalLicenseSession,
  hasStaffValidationContext
}) => ({
  _validateInBackground: async (licenseKey, options = {}) => {
    const { refreshProfile = false, reason = 'background' } = options || {};

    try {
      const initialState = get();

      if (initialState.appStatus !== 'ready') {
        Logger.log('[Background] La sesiÃ³n no estÃ¡ lista; se conserva la pantalla actual.');
        return;
      }

      const localLicenseBeforeValidation = await getLicenseFromStorage();
      if (get().appStatus !== 'ready') return;
      const licenseDetails = initialState.licenseDetails || localLicenseBeforeValidation || {
        license_key: licenseKey
      };
      ¶»§q«^