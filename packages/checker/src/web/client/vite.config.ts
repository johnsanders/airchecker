import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The SPA only ever runs on this dev server, which proxies /api and the /ws websocket
// to the running Fastify server (npm run backend).
export default defineConfig({
	plugins: [react()],
	server: {
		port: 5173,
		proxy: {
			'/api': 'http://localhost:8787',
			'/ws': { target: 'ws://localhost:8787', ws: true },
		},
		strictPort: true,
	},
});
