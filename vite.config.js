import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './client/src'),
      '@shared': path.resolve(__dirname, './shared')
    }
  },
  root: './client',
  build: {
    outDir: '../dist/public',
    rollupOptions: {
      input: path.resolve(__dirname, './client/index.html'),
      output: {
        manualChunks: {
          // Split vendor libraries into separate chunks
          'react-vendor': ['react', 'react-dom'],
          'router': ['wouter'],
          'ui-components': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-tooltip'
          ],
          'icons': ['lucide-react', 'react-icons'],
          'forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
          'state-management': ['@tanstack/react-query']
        }
      }
    },
    chunkSizeWarningLimit: 600 // Increase limit slightly since we're implementing code splitting
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      }
    }
  }
});