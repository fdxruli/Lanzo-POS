export function isPublicStorePath(pathname = '') {
  const normalizedPath = typeof pathname === 'string' ? pathname : '';
  return /^\/tienda(?:\/[^/?#]+)?\/?$/.test(normalizedPath);
}

export default isPublicStorePath;
