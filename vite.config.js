import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import packageJson from './package.json';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt', // CRÍTICO: Cambiado de autoUpdate a prompt
      injectRegister: 'auto',
      includeAssets: ['log.svg', 'logIcon.svg', 'pwa-192x192.png', 'pwa-512x512.png'],
      devOptions: {
        enabled: true,
        type: 'module',
        navigateFallback: 'index.html',
      },
      manifest: {
        name: 'Lanzo POS',
        short_name: 'Lanzo',
        description: 'Sistema de Punto de Venta e Inventario',
        theme_color: '#FF3B5C',
        background_color: '#E8EAED',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        // Obliga a limpiar assets viejos SOLO cuando el SW nuevo toma el control de forma segura
        cleanupOutdatedCaches: true,
        // Pre-cachea todo el código necesario para modo offline
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Asegura que las rutas de React Router siempre devuelvan el index.html
        navigateFallback: '/index.html',
        // IMPORTANTE: Evita que el Service Worker intercepte llamadas a tu API (Supabase/Backend)
        navigateFallbackDenylist: [/^\/api/, /^\/auth/]
      }
    })
  ],

  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageJson.version),
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
          'vendor_heavy': ['react-zxing']
        }
      }
    }
  }
});