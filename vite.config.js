import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// `base: './'` makes every asset URL relative, so the build works unchanged
// whether GitHub Pages serves it at https://<user>.github.io/<repo>/ or at a custom domain.
// Two decks, one site: the river deck at ./ and the linear-algebra deck at ./linear-algebra/.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        linearAlgebra: resolve(import.meta.dirname, 'linear-algebra/index.html'),
      },
    },
  },
  worker: { format: 'es' },
  // Flow solves and optimizer runs are compute-heavy; give them room on busy machines and CI runners.
  test: { environment: 'node', include: ['tests/**/*.test.js'], testTimeout: 60000 },
});
