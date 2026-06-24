import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy REST + the live WebSocket to the Express backend during development so
// the browser only ever talks to the Vite origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:5000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
