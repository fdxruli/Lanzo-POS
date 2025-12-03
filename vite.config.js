import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // 1. Optimización de compilación
    target: 'esnext', // Código moderno más ligero y rápido
    minify: 'esbuild', // Minificación rápida
    cssCodeSplit: true, // CSS por separado para no bloquear renderizado
    
    // 2. Reporte de tamaño (para que veas qué pesa más)
    chunkSizeWarningLimit: 1000, // Aumentamos el límite de aviso a 1MB

    rollupOptions: {
      output: {
        // 3. ESTRATEGIA MANUAL DE CHUNKS (La clave de la optimización)
        manualChunks: {
          // Núcleo de React (siempre necesario)
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          
          // Estado y Utilidades (Zustand es ligero, pero mejor separado)
          'vendor-utils': ['zustand'],
          
          // Iconos (Suelen pesar mucho si se importan todos)
          'vendor-icons': ['lucide-react'],
          
          // Supabase (Pesado, mejor aislarlo)
          'vendor-supabase': ['@supabase/supabase-js'],
          
          // Escáner y Gráficos (Solo se cargan cuando se usan)
          'vendor-heavy': ['react-zxing'] // Si usas recharts u otros pesados
        }
      }
    }
  }
});