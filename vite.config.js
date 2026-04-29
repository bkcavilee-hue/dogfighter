import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, open: true },
  build: {
    target: 'esnext',
    sourcemap: true,         // production sourcemaps so console errors point to real source
    chunkSizeWarningLimit: 3000,
  },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
