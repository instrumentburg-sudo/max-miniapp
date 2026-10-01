import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  return {
  plugins: [react(), {
    name: 'cabinet-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (env.VITE_BASE_PATH !== '/cabinet/') return html;
        // zayavka CSP allows only local CSS/fonts and external script files.
        // Keep the original max-app HTML unchanged for the existing host.
        return html
          .replace(/href="\/max-app\/fonts\//g, 'href="/cabinet/fonts/')
          .replace(/<link\b[^>]*href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, '')
          .replace(/<style>[\s\S]*?<\/style>/, '<link rel="stylesheet" href="/src/styles/bootstrap.css">')
          .replace(/<script>[\s\S]*?<\/script>/, '<script type="module" src="/src/bootstrap.js"></script>');
      },
    },
  }],
  base: env.VITE_BASE_PATH || '/max-app/',
  build: {
    outDir: env.VITE_BASE_PATH === '/cabinet/' ? 'dist-cabinet' : 'dist',
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
  };
});
