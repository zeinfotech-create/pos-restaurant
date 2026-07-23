import { defineConfig } from 'vite';

export default defineConfig({
  // IMPORTANT: './' base so assets load correctly in Electron (file:// protocol)
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
