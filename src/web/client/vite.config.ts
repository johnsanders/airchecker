import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Builds the SPA into ./dist, which Fastify serves as static files. The dev server
// proxies /api and the /ws websocket to the running Fastify server (npm run live)
// for hot-reload dev.
export default defineConfig({
  build: { outDir: 'dist' },
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
