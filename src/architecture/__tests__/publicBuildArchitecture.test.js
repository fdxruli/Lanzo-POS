// @vitest-environment node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const readProjectFile = (relativePath) => readFile(path.join(projectRoot, relativePath), 'utf8');

async function walk(relativeDirectory) {
  const absoluteDirectory = path.join(projectRoot, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(relativePath));
    else if (entry.isFile()) files.push(relativePath.replaceAll('\\', '/'));
  }
  return files;
}

describe('standalone public build architecture', () => {
  it('boots only the public router and never imports the administrative App', async () => {
    const entry = await readProjectFile('src/main-store.jsx');

    expect(entry).toContain("from './router/publicStoreRoutes'");
    expect(entry).not.toMatch(/App\.jsx|renderPosApplication|GoogleOAuthProvider|StorageManager/);
  });

  it('uses an isolated public Supabase client with no administrative imports or session persistence', async () => {
    const [service, client] = await Promise.all([
      readProjectFile('src/services/ecommerce/ecommercePublicService.js'),
      readProjectFile('src/services/supabasePublic.js')
    ]);

    expect(service).toMatch(/from ['"]\.\.\/supabasePublic['"]/);
    expect(service).not.toMatch(/from ['"]\.\.\/supabase['"]/);
    expect(client).toContain('VITE_SUPABASE_URL');
    expect(client).toContain('VITE_SUPABASE_PUBLISHABLE_KEY');
    expect(client).toMatch(/persistSession:\s*false/);
    expect(client).toMatch(/autoRefreshToken:\s*false/);
    expect(client).toMatch(/detectSessionInUrl:\s*false/);
    expect(client).not.toMatch(/FingerprintJS|LanzoDB|database|Logger|license|staff|device/i);
  });

  it('keeps the public HTML free of administrative PWA bootstrapping', async () => {
    const html = await readProjectFile('store/index.html');

    expect(html).toContain('../src/main-store.jsx');
    expect(html).toContain('Tienda en línea — Lanzo');
    expect(html).not.toMatch(/rel=["']manifest|manifest\.webmanifest|beforeinstallprompt|appinstalled/i);
    expect(html).not.toMatch(/apple-mobile-web-app-capable|mobile-web-app-capable|apple-touch-icon/i);
    expect(html).not.toMatch(/registerSW|serviceWorker|virtual:pwa-register/i);
  });

  it('builds to dist-store from a dedicated root without a PWA plugin or public asset copy', async () => {
    const config = await readProjectFile('vite.store.config.js');

    expect(config).toContain("path.join(projectRoot, 'store')");
    expect(config).toContain("path.join(projectRoot, 'dist-store')");
    expect(config).toMatch(/publicDir:\s*false/);
    expect(config).toMatch(/plugins:\s*\[react\(\)\]/);
    expect(config).not.toMatch(/VitePWA|vite-plugin-pwa|workbox|manifest\.webmanifest/);
  });

  it('contains no Service Worker, Workbox, manifest, or administrative chunks after the public build', async () => {
    const files = await walk('dist-store');
    const joined = files.join('\n');

    expect(files).toContain('dist-store/index.html');
    expect(joined).not.toMatch(/(^|\/)sw\.js$/im);
    expect(joined).not.toMatch(/workbox-|registerSW|manifest\.webmanifest/i);
    expect(joined).not.toMatch(/App-|PosPage|Caja|Dashboard|Settings|AssistantBot|ScannerModal|vendor_charts/i);
  });
});
