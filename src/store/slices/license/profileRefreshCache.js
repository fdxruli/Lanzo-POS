import {
  PROFILE_LAST_LICENSE_KEY,
  PROFILE_LAST_LOAD_KEY
} from './licenseConstants';

export const invalidateProfileRefreshMetadata = () => {
  try {
    localStorage.removeItem(PROFILE_LAST_LOAD_KEY);
    localStorage.removeItem(PROFILE_LAST_LICENSE_KEY);
  } catch {
    // Best effort: invalidar el TTL no debe bloquear el cierre de sesión.
  }
};
