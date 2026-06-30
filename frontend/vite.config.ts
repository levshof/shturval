import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev we proxy /api to the backend so there is no CORS friction.
// In production the frontend calls VITE_API_URL directly (see src/lib/api.ts).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_BACKEND ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
