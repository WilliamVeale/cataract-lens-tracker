// Astro builds one static page into dist/. See docs/spec.md, "How it is built and hosted".
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  vite: { plugins: [tailwindcss()] },
});
