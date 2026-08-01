// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  extractPrecachedAssetUrls,
  extractReferencedStartupAssets,
  findMissingStartupPrecacheAssets,
} from '../../../scripts/admin-startup-precache-audit.mjs';

const bootstrapSource = `
  const map = [
    "assets/App-current.js",
    "assets/useInventoryCatalogStore-current.js",
    "assets/productStoreRecoveryGuard-current.js",
    "assets/DevConsole-current.css",
    "assets/logo-current.png"
  ];
  import("./assets/App-current.js");
`;

describe('administrative startup precache audit', () => {
  it('extracts the complete JavaScript and CSS startup closure without duplicates', () => {
    expect(extractReferencedStartupAssets(bootstrapSource)).toEqual([
      'assets/App-current.js',
      'assets/DevConsole-current.css',
      'assets/productStoreRecoveryGuard-current.js',
      'assets/useInventoryCatalogStore-current.js',
    ]);
  });

  it('reads Workbox precache entries from generated worker syntax', () => {
    expect(extractPrecachedAssetUrls(`
      precacheAndRoute([
        {"revision":null,"url":"assets/App-current.js"},
        {revision:null,url:"assets/useInventoryCatalogStore-current.js"}
      ]);
    `)).toEqual([
      'assets/App-current.js',
      'assets/useInventoryCatalogStore-current.js',
    ]);
  });

  it('reports every referenced startup asset missing from the Service Worker', () => {
    const missing = findMissingStartupPrecacheAssets({
      bootstrapSource,
      workerSource: `
        precacheAndRoute([
          {"revision":null,"url":"assets/App-current.js"},
          {"revision":null,"url":"assets/DevConsole-current.css"}
        ]);
      `,
    });

    expect(missing).toEqual([
      'assets/productStoreRecoveryGuard-current.js',
      'assets/useInventoryCatalogStore-current.js',
    ]);
  });
});
