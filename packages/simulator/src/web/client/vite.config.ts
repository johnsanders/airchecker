import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The control page only ever runs on this dev server, which proxies /api and the simulated
// air feed at /air/ to the running Fastify server (npm run server).
export default defineConfig({
	plugins: [react()],
	server: {
		port: 5174,
		proxy: { '/air': 'http://localhost:8788', '/api': 'http://localhost:8788' },
		strictPort: true,
	},
});
