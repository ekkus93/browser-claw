/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };
const releaseConfig = JSON.parse(
  readFileSync(
    new URL('./release/release-config.json', import.meta.url),
    'utf8',
  ),
) as { extensionId: string };

const version = process.env.VITE_RELEASE_VERSION ?? packageJson.version;
const gitSha = process.env.VITE_GIT_SHA ?? 'development';
const buildUtc = process.env.VITE_BUILD_UTC ?? new Date(0).toISOString();
const releaseChannel = process.env.VITE_RELEASE_CHANNEL ?? 'development';
const extensionId =
  process.env.VITE_CHROME_EXTENSION_ID ?? releaseConfig.extensionId;

export default defineConfig({
  root,
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  define: {
    __BROWSERCLAW_VERSION__: JSON.stringify(version),
    __BROWSERCLAW_GIT_SHA__: JSON.stringify(gitSha),
    __BROWSERCLAW_BUILD_UTC__: JSON.stringify(buildUtc),
    __BROWSERCLAW_RELEASE_CHANNEL__: JSON.stringify(releaseChannel),
    __BROWSERCLAW_EXTENSION_ID__: JSON.stringify(extensionId),
  },
  build: {
    rolldownOptions: {
      output: {
        strictExecutionOrder: true,
        codeSplitting: {
          groups: [
            {
              name: 'react-runtime',
              test: /node_modules[\\/](?:react|react-dom|react-router|react-redux|scheduler)[\\/]/,
              priority: 40,
              maxSize: 300_000,
            },
            {
              name: 'state-storage',
              test: /node_modules[\\/](?:@reduxjs|redux|dexie|immer|reselect)[\\/]/,
              priority: 30,
              maxSize: 300_000,
            },
            {
              name: 'quickjs-runtime',
              test: /node_modules[\\/](?:quickjs-emscripten|quickjs-emscripten-core|@jitl)[\\/]/,
              priority: 30,
              maxSize: 300_000,
            },
            {
              name: 'local-model-runtime',
              test: /node_modules[\\/]@wllama[\\/]/,
              priority: 30,
              maxSize: 300_000,
            },
            {
              name: 'vendor',
              test: /node_modules/,
              priority: 10,
              maxSize: 300_000,
            },
          ],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
