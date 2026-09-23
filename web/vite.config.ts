import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Stock Management System',
        short_name: 'SMS',
        description: 'Reagent and materials stock for every business unit',
        theme_color: '#0f766e',
        background_color: '#f6f9fb',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell offline; API is always network (counts must never be served stale).
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/export\//, /^\/ingest\//, /^\/health/],
        runtimeCaching: [
          { urlPattern: /^https:\/\/fonts\.googleapis\.com\//, handler: 'StaleWhileRevalidate', options: { cacheName: 'fonts-css' } },
          { urlPattern: /^https:\/\/fonts\.gstatic\.com\//, handler: 'CacheFirst', options: { cacheName: 'fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } } },
        ],
      },
    }),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5174,
    proxy: {
      '/api': { target: process.env.SMS_API_URL ?? 'http://127.0.0.1:8095', changeOrigin: true },
      '/export': { target: process.env.SMS_API_URL ?? 'http://127.0.0.1:8095', changeOrigin: true },
      '/health': { target: process.env.SMS_API_URL ?? 'http://127.0.0.1:8095', changeOrigin: true },
    },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 700 },
});
