/**
 * Real Chrome extension transport (FIX1-B1). Sends validated protocol messages
 * to the Web Research Companion via `chrome.runtime.sendMessage`. Only usable
 * in a browser with the extension installed; the transport rejects immediately
 * when chrome.runtime is absent (e.g. non-Chromium browsers, unit tests) so
 * callers can handle it as `extension_missing`.
 *
 * The extension ID must be provided; in dev set VITE_CHROME_EXTENSION_ID.
 */

import type { ExtensionTransport } from './pageReaderProvider.ts';
import type { ExtensionRequest } from './protocol.ts';

// `chrome` is a browser-global; not typed in the app's tsconfig (no
// @types/chrome dependency). Access via globalThis with an explicit cast so the
// strict compiler does not reject the reference.
type ChromeRuntime = {
  sendMessage(
    extensionId: string,
    message: unknown,
    callback: (response: unknown) => void,
  ): void;
  lastError?: { message?: string };
};

function getChromeRuntime(): ChromeRuntime | undefined {
  const g = globalThis as Record<string, unknown>;
  const cr =
    typeof g['chrome'] === 'object' && g['chrome'] !== null
      ? (g['chrome'] as { runtime?: ChromeRuntime })
      : null;
  return cr?.runtime;
}

export function createChromeExtensionTransport(
  extensionId: string,
): ExtensionTransport {
  return {
    send(message: ExtensionRequest): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const runtime = getChromeRuntime();
        if (!runtime) {
          reject(new Error('Chrome extension runtime not available'));
          return;
        }
        if (!extensionId) {
          reject(
            new Error(
              'Chrome extension ID not configured (set VITE_CHROME_EXTENSION_ID)',
            ),
          );
          return;
        }
        runtime.sendMessage(extensionId, message, (response) => {
          if (runtime.lastError) {
            reject(
              new Error(
                runtime.lastError.message ?? 'Extension message failed',
              ),
            );
          } else {
            resolve(response);
          }
        });
      });
    },
  };
}
