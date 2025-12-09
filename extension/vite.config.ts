import { defineConfig } from 'vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';

import manifest from './src/manifest';

const htmlInputs = [
  'src/pages/popup/index.html',
  'src/pages/options/index.html',
  'src/pages/dashboard/index.html',
  'src/pages/reminder/index.html',
  'src/pages/consent/index.html'
];

const inputMap = htmlInputs.reduce<Record<string, string>>((acc, relativePath) => {
  const key = relativePath
    .replace('src/pages/', '')
    .replace('/index.html', '')
    .replace(/\//g, '-');
  acc[key] = resolve(__dirname, relativePath);
  return acc;
}, {});

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: inputMap
    }
  }
});
