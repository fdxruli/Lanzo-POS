import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const publicVendorChunk = (id) => {
  if (!id.includes('node_modules')) return undefined;
  if (/node_modules[\\/](@supabase|ws|websocket)/.test(id)) return 'vendor_supabase_public';
  if (/node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
    return 'vendor_react_public';
  }
  if (id.includes('node_modules/lucide-react')) return 'vendor_icons_public';
  if (/node_modules[\\/](dexie|big\.js)[\\/]/.test(id)) return 'vendor_store_public';
  return 'vendor_public';
};

export default defineConfig({
  root: path.join(projectRoot, 'store'),
  base: '/',
  envDir: projectRoot,
  publicDir: false,
  appType: 'spa',
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom']
  },
  build: {
    outDir: path.join(projectRoot, 'dist-store'),
    emptyOutDir: true,
    target: 'esnext',
    minify: 'esbuild',
    cssCodeSplit: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: publicVendorChunk
      }
    }
  }
});
