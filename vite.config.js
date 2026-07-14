import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import packageJson from './package.json';
import { serializeAdminManifest } from './src/pwa/adminManifest';

const ADMIN_SHELL_GLOB_PATTERNS = Object.freeze([
  'index.html',
  'manifest.webmanifest',
  'pwa-192x192.png',
  'pwa-512x512.png',
  'logIcon.svg',
  'assets/index-*.{js,css}',
  'assets/App-*.{js,css}',
  'assets/vendor_react-*.js',
  'assets/vendor_icons-*.js',
  'assets/vendor_supabase-*.js',
  'assets/vendor_utils-*.js',
  'assets/useAppStore-*.js',
  'assets/Logger-*.js',
  'assets/ErrorBoundary-*.{js,css}',
  'assets/storageManager-*.js',
  'assets/salesCloudShadowService-*.js',
  'assets/index.esm-*.js',
  'assets/posSyncBootstrapAutoCoordinator-*.js',
  'assets/customerCreditSyncHandler-*.js',
  'assets/cashSyncHandler-*.js',
  'assets/devServiceWorkerCleanup-*.js',
  'assets/devConsoleCapture-*.js',
  'assets/mobileZoomGuard-*.js',
]);

const adminManifestPlugin = () => ({
  name: 'lanzo-admin-manifest',
  apply: 'build',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'manifest.webmanifest',
      source: serializeAdminManifest(),
    });
  },
});

const getGitCommit = () => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'local';
  }
};

const buildDate = new Date().toISOString();
const buildCommit = getGitCommit();

export default defineConfig(() => ({
  plugins: [
    react(),
    adminManifestPlugin(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/pwa',
      filename: 'sw.js',
      scope: '/',
      registerType: 'prompt',
      injectRegister: false,
      devOptions: {
        enabled: false,
        type: 'module',
        navigateFallback: 'index.html',
      },
      manifest: false,
      injectManifest: {
        globPatterns: ADMIN_SHELL_GLOB_PATTERNS,
      },
    })
  ],

  test: {
    setupFiles: ['./src/test/setupTestingLibrary.js'],
    testTimeout: 15_000,
  },

  resolve: {
    dedupe: ['react', 'react-dom'],
  },

  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageJson.version),
    'import.meta.env.VITE_BUILD_DATE': JSON.stringify(buildDate),
    'import.meta.env.VITE_BUILD_COMMIT': JSON.stringify(buildCommit),
  },

  build: {
    target: 'esnext',
    minify: 'esbuild',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 1000,

    rollupOptions: {
      output: {
        manualChunks: {
          'vendor_react': ['react', 'react-dom', 'react-router-dom'],
          'vendor_utils': ['zustand'],
          'vendor_icons': ['lucide-react'],
          'vendor_supabase': ['@supabase/supabase-js'],
          'vendor_heavy': ['react-zxing'],
          'vendor_charts': ['recharts']
        }
      }
    }
  }
}));
