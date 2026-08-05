import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // pdfjs-dist ships modern syntax (top-level await in some builds);
  // target esnext so Vite doesn't choke transpiling it.
  build: { target: 'esnext' },
});
