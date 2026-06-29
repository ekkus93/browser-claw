/**
 * D1+D2 (FIX5): shared extension E2E helpers.
 * - getServiceWorker: avoids races where the service worker registers before a bare
 *   waitForEvent listener is attached.
 * - stageExtensionDir: copies an extension fixture to a temp directory with all
 *   symlinks dereferenced, so Chrome/headless loads real files (D2).
 * - assertExtensionFixture: fails fast with a clear message on missing files or symlinks.
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type { BrowserContext, Worker } from '@playwright/test';

export async function getServiceWorker(
  context: BrowserContext,
): Promise<Worker> {
  const existing = context.serviceWorkers()[0];
  if (existing) return existing;
  return context.waitForEvent('serviceworker', { timeout: 20_000 });
}

export async function getExtensionId(context: BrowserContext): Promise<string> {
  const sw = await getServiceWorker(context);
  return sw.url().split('/')[2]!;
}

/**
 * D2 (FIX5): copy an extension directory to a temp dir, dereferencing all symlinks.
 * Returns the path to the staged directory. Call from beforeAll; pass the result as
 * the extension path to Playwright's --load-extension flag.
 */
export function stageExtensionDir(srcDir: string): string {
  const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'bclaw-ext-'));
  fs.cpSync(srcDir, staged, { recursive: true, dereference: true });
  return staged;
}

export function assertExtensionFixture(extensionDir: string): void {
  const manifestPath = path.join(extensionDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing extension manifest: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    background?: { service_worker?: string };
  };
  const sw = manifest.background?.service_worker;
  if (typeof sw !== 'string') {
    throw new Error(
      'Extension manifest does not define background.service_worker',
    );
  }
  const swPath = path.join(extensionDir, sw);
  if (!fs.existsSync(swPath)) {
    throw new Error(`Missing extension service worker: ${swPath}`);
  }
  // D2 (FIX5): symlinked service workers can be fragile in Docker/headless contexts.
  const stat = fs.lstatSync(swPath);
  if (stat.isSymbolicLink()) {
    throw new Error(
      `Extension service worker must be a real file, not a symlink: ${swPath}`,
    );
  }
}
