import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const fixture = fileURLToPath(new URL('./fixture.jsx', import.meta.url));

// Separate build only. These aliases never participate in the POS build.
export default defineConfig({
  root: here,
  plugins: [react()],
  resolve: { alias: [
    { find: /.*\/useAppStore(?:\.js)?$/, replacement: fixture },
    { find: /.*\/useActorRuntimeSnapshot(?:\.js)?$/, replacement: fixture },
    { find: /.*\/useSettingsAccess(?:\.js)?$/, replacement: fixture },
    { find: /.*\/aiAgentAuthorization(?:\.js)?$/, replacement: fixture },
    { find: /.*\/useConfirmDiscard(?:\.js)?$/, replacement: fixture },
    { find: /.*\/useBackupManager(?:\.js)?$/, replacement: fixture },
    { find: /.*\/usePersistentStorage(?:\.js)?$/, replacement: fileURLToPath(new URL('./persistent.js', import.meta.url)) },
    { find: /.*\/BackupRiskEvaluator(?:\.js)?$/, replacement: fixture },
    { find: /.*\/NotificationBell(?:\.jsx)?$/, replacement: fixture }
  ] },
  server: { host: '127.0.0.1', port: 5178, fs: { allow: [fileURLToPath(new URL('../../../', import.meta.url))] } },
  build: { outDir: '../../../.tmp-about-free-preview', emptyOutDir: true }
});
