import { ADMIN_MANIFEST_PATH } from './adminManifest';

const ADMIN_PWA_ATTRIBUTE = 'data-lanzo-admin-pwa';

const ADMIN_META = Object.freeze([
  ['apple-mobile-web-app-capable', 'yes'],
  ['apple-mobile-web-app-status-bar-style', 'black'],
  ['mobile-web-app-capable', 'yes'],
]);

function appendMeta(documentRef, name, content) {
  const meta = documentRef.createElement('meta');
  meta.setAttribute('name', name);
  meta.setAttribute('content', content);
  meta.setAttribute(ADMIN_PWA_ATTRIBUTE, 'true');
  documentRef.head.append(meta);
}

export function removeAdminPwaDocument(documentRef = document) {
  documentRef.querySelectorAll(`[${ADMIN_PWA_ATTRIBUTE}]`).forEach((element) => element.remove());
}

export function installAdminPwaDocument(documentRef = document) {
  removeAdminPwaDocument(documentRef);

  const existingManifestLinks = documentRef.querySelectorAll('link[rel="manifest"]');
  existingManifestLinks.forEach((element) => element.remove());

  const manifest = documentRef.createElement('link');
  manifest.setAttribute('rel', 'manifest');
  manifest.setAttribute('href', ADMIN_MANIFEST_PATH);
  manifest.setAttribute(ADMIN_PWA_ATTRIBUTE, 'true');
  documentRef.head.append(manifest);

  ADMIN_META.forEach(([name, content]) => appendMeta(documentRef, name, content));

  const touchIcon = documentRef.createElement('link');
  touchIcon.setAttribute('rel', 'apple-touch-icon');
  touchIcon.setAttribute('href', '/pwa-192x192.png');
  touchIcon.setAttribute(ADMIN_PWA_ATTRIBUTE, 'true');
  documentRef.head.append(touchIcon);

  return () => removeAdminPwaDocument(documentRef);
}
