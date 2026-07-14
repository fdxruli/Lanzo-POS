export const ADMIN_MANIFEST_PATH = '/manifest.webmanifest';

export const ADMIN_WEB_MANIFEST = Object.freeze({
  name: 'Lanzo POS',
  short_name: 'Lanzo',
  description: 'Sistema de Punto de Venta e Inventario',
  start_url: '/',
  display: 'standalone',
  background_color: '#F7F8FA',
  theme_color: '#FFFFFF',
  lang: 'es-MX',
  scope: '/',
  orientation: 'portrait',
  icons: [
    { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
    { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
    { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ],
});

export const serializeAdminManifest = () => JSON.stringify(ADMIN_WEB_MANIFEST);
