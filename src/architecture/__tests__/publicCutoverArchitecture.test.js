// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const readProjectFile = (relativePath) => readFile(path.join(projectRoot, relativePath), 'utf8');

describe('ECOM.PUBLIC.CUTOVER.1 architecture', () => {
  it('centralizes both production origins and Vite overrides', async () => {
    const source = await readProjectFile('src/config/publicOrigins.js');
    expect(source).toContain('https://lanzo-store.vercel.app');
    expect(source).toContain('https://lanzo-pos.vercel.app');
    expect(source).toContain('VITE_PUBLIC_STORE_ORIGIN');
    expect(source).toContain('VITE_ADMIN_APP_ORIGIN');
  });

  it('uses the central builder for every administrative store action', async () => {
    const source = await readProjectFile('src/components/ecommerce/EcommercePortalSettings.jsx');
    expect(source).toContain('buildPublicStoreUrl(portal.slug)');
    expect(source).not.toContain('window.location.origin}/tienda');
    expect(source).toContain('navigator.share');
    expect(source).toContain('<PublicStoreQrCode value={reservedLink}');
  });

  it('uses the central tracking builder after checkout', async () => {
    const source = await readProjectFile('src/components/ecommerce/public/PublicOrderConfirmation.jsx');
    expect(source).toContain('buildPublicTrackingUrl(slug, trackingToken)');
    expect(source).not.toContain('globalThis.location?.origin');
    expect(source).toContain('appendPublicTrackingToWhatsappUrl');
  });

  it('uses the administrative origin for landing acquisition CTAs', async () => {
    const source = await readProjectFile('src/pages/PublicLanzoLandingPage.jsx');
    expect(source).toContain('buildAdminWelcomeUrl()');
    expect(source).not.toContain('href="/?welcome=1"');
  });

  it('preserves the legacy public router in the administrative entry', async () => {
    const source = await readProjectFile('src/main.jsx');
    expect(source).toContain("from './router/publicStoreRoutes'");
    expect(source).toContain('if (isPublicStorePath(window.location.pathname))');
  });

  it('preserves all public route registrations', async () => {
    const source = await readProjectFile('src/router/publicStoreRoutes.jsx');
    expect(source).toContain("path: '/tienda/:slug/pedido/:trackingToken'");
    expect(source).toContain("path: '/tienda/:slug'");
    expect(source).toContain("path: '/tienda'");
    expect(source).toContain("path: '/conoce-lanzo'");
  });

  it('adds no administrative redirect from legacy public paths', async () => {
    const config = JSON.parse(await readProjectFile('vercel.json'));
    expect(config.redirects || []).toEqual([]);
    expect(config.rewrites).toContainEqual({ source: '/(.*)', destination: '/index.html' });
  });

  it('keeps the public deployment rewrites and canonical trailing slash policy', async () => {
    const config = JSON.parse(await readProjectFile('store/vercel.json'));
    expect(config.trailingSlash).toBe(false);
    expect(config.rewrites).toEqual(expect.arrayContaining([
      { source: '/tienda', destination: '/index.html' },
      { source: '/tienda/:path*', destination: '/index.html' },
      { source: '/conoce-lanzo', destination: '/index.html' }
    ]));
  });

  it('keeps public paths in the administrative Service Worker denylist', async () => {
    const source = await readProjectFile('src/pwa/publicNavigationPolicy.js');
    expect(source).toMatch(/\^\\\/tienda/);
    expect(source).toMatch(/\^\\\/conoce-lanzo/);
  });

  it('keeps the standalone public build free of PWA configuration', async () => {
    const source = await readProjectFile('vite.store.config.js');
    expect(source).not.toMatch(/VitePWA|workbox|manifest\.webmanifest|serviceWorker/);
    expect(source).toMatch(/publicDir:\s*false/);
  });

  it('keeps administrative order navigation relative', async () => {
    const [navbar, orderSummary] = await Promise.all([
      readProjectFile('src/components/layout/Navbar.jsx'),
      readProjectFile('src/components/pos/OrderSummary.jsx')
    ]);
    expect(navbar).toContain("to: '/pedidos-online'");
    expect(orderSummary).toContain('navigate(`/pedidos-online?order=');
  });

  it('does not add a public PWA entry point or administrative import to main-store', async () => {
    const source = await readProjectFile('src/main-store.jsx');
    expect(source).not.toMatch(/App\.jsx|VitePWA|virtual:pwa-register|serviceWorker/);
    expect(source).toContain("from './router/publicStoreRoutes'");
  });
});
