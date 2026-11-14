import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), cloudflare()],
  build: {
    target: 'es2022',
    sourcemap: false,
    rolldownOptions: {
      output: {
        // MapLibre's worker ships as .mjs. Some static servers send .mjs without a JavaScript type, and with
        // nosniff the browser then refuses the worker, so it is emitted with a plain .js name.
        assetFileNames: (asset) =>
          asset.names.some((n) => n.endsWith('.mjs')) ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
