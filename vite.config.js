import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { precacheManifest } from './scripts/vite-precache.mjs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({ plugins: [react(), precacheManifest()], base: './', define: { __APP_VERSION__: JSON.stringify(version) } });
