import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa'; // <--- 1. IMPORTACIÓN NUEVA

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['log.svg', 'logIcon.svg'],
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
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
  
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