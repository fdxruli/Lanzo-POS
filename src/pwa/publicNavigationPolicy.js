export const PUBLIC_NAVIGATION_DENYLIST = Object.freeze([
  /^\/api(?:\/|[?#]|$)/,
  /^\/auth(?:\/|[?#]|$)/,
  /^\/tienda(?:\/|[?#]|$)/,
  /^\/conoce-lanzo(?:\/|[?#]|$)/,
]);

export function isPublicNavigationPath(pathname = '') {
  return /^\/(?:tienda(?:\/|$)|conoce-lanzo(?:\/|$))/.test(String(pathname));
}

export function isPublicNavigationRequest({ request, url, serviceWorkerOrigin }) {
  return request?.method === 'GET'
    && request?.mode === 'navigate'
    && url?.origin === serviceWorkerOrigin
    && isPublicNavigationPath(url.pathname);
}
