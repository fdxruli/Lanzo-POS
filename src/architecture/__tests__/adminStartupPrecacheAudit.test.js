// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  extractCoreLocalRouteAssets,
  extractPrecachedAssetUrls,
  extractReferencedStartupAssets,
  extractViteDependencyMap,
  findMissingCoreLocalRoutePrecacheAssets,
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

const appSource = `
  const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=[
    "assets/PosPage-current.js",
    "assets/vendor_react-current.js",
    "assets/DashboardPage-current.js",
    "assets/vendor_charts-current.js",
    "assets/DashboardPage-current.css"
  ])))=>i.map(i=>d[i]);
  const PosPage = lazy(() => import("./PosPage-current.js"),__vite__mapDeps([0,1]));
  const DashboardPage = lazy(() => import("./DashboardPage-current.js"),__vite__mapDeps([2,1,3,4]));
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

  it('extracts the complete Vite dependency map used by lazy route chunks', () => {
    expect(extractViteDependencyMap(appSource)).toEqual([
      'assets/PosPage-current.js',
      'assets/vendor_react-current.js',
      'assets/DashboardPage-current.js',
      'assets/vendor_charts-current.js',
      'assets/DashboardPage-current.css',
    ]);
  });

  it('derives the complete transitive closure for core Local routes', () => {
    expect(extractCoreLocalRouteAssets(
      appSource,
      ['PosPage', 'DashboardPage'],
    )).toEqual([
      'assets/DashboardPage-current.css',
      'assets/DashboardPage-current.js',
      'assets/PosPage-current.js',
      'assets/vendor_charts-current.js',
      'assets/vendor_react-current.js',
    ]);
  });

  it('fails when a transitive Local route dependency is absent from precache', () => {
    const missing = findMissingCoreLocalRoutePrecacheAssets({
      appSource,
      routePrefixes: ['PosPage', 'DashboardPage'],
      workerSource: `
        precacheAndRoute([
          {"revision":null,"url":"assets/PosPage-current.js"},
          {"revision":null,"url":"assets/vendor_react-current.js"},
          {"revision":null,"url":"assets/DashboardPage-current.js"}
        ]);
      `,
    });

    expect(missing).toEqual([
      'assets/DashboardPage-current.css',
      'assets/vendor_charts-current.js',
    ]);
  });
});
