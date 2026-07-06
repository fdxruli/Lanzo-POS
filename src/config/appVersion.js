const rawVersion = import.meta.env.VITE_APP_VERSION || '0.0.0';

export const APP_VERSION = rawVersion.startsWith('v') ? rawVersion : `v${rawVersion}`;
export const APP_VERSION_NUMBER = rawVersion.replace(/^v/, '');
export const APP_BUILD_DATE = import.meta.env.VITE_BUILD_DATE || '';
export const APP_BUILD_COMMIT = import.meta.env.VITE_BUILD_COMMIT || 'local';

export const APP_BUILD_DATE_LABEL = APP_BUILD_DATE
  ? new Date(APP_BUILD_DATE).toLocaleString()
  : 'Build local';

export const APP_VERSION_LABEL = `${APP_VERSION}${APP_BUILD_COMMIT ? ` (${APP_BUILD_COMMIT})` : ''}`;
