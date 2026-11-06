import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const resolve = (path) => fileURLToPath(new URL(path, import.meta.url));

// Isolated UI fixture. No app bootstrap, credentials, database or financial writes.
export default defineConfig({
  root: resolve('./'),
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /.*\/services\/customerMessaging$/,
        replacement: resolve('../../../src/services/customerMessaging/normalizers.js')
      },
      { find: /.*\/services\/db\/dexie$/, replacement: resolve('./no-database.js') }
    ]
  },
  server: { host: '127.0.0.1', port: 5176, strictPort: true, fs: { allow: [resolve('../../../')] } }
});
