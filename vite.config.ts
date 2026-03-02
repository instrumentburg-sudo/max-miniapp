import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/max-app/',
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 5180,
    proxy: {
      '/max-api': {
        target: 'http://localhost:8100',
        rewrite: (path) => path.replace(/^\/max-api/, ''),
      },
    },
  },
});
