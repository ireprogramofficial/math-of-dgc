import { defineConfig } from 'vite';

// `base: './'` makes every asset URL relative, so the build works unchanged
// whether GitHub Pages serves it at https://<user>.github.io/<repo>/ or at a custom domain.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['tests/**/*.test.js'] },
});
