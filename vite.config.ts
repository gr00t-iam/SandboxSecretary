import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isGitHubPages = process.env.GITHUB_PAGES === 'true';

export default defineConfig({
  plugins: [react()],
  base: isGitHubPages ? '/SandboxSecretary/' : '/',
  worker: {
    format: 'es'
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'index.html'),
        standalone: resolve(__dirname, 'sandbox-secretary.html')
      }
    }
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  }
});
