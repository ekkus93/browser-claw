import { describe, expect, it } from 'vitest';
import { createChromeExtensionTransport } from './chromeTransport.ts';

describe('createChromeExtensionTransport (FIX1-B1)', () => {
  it('returns a transport with a send function', () => {
    const t = createChromeExtensionTransport('fake-ext-id');
    expect(typeof t.send).toBe('function');
  });

  it('rejects immediately when chrome runtime is absent (non-Chrome environment)', async () => {
    const t = createChromeExtensionTransport('fake-ext-id');
    await expect(t.send({ type: 'ping', requestId: 'r1' })).rejects.toThrow(
      /Chrome extension runtime not available/,
    );
  });

  it('rejects immediately when extension ID is empty', async () => {
    // Simulate a browser environment with chrome.runtime present but no
    // extensionId configured — should fail fast with a clear error.
    const originalGlobal = globalThis as Record<string, unknown>;
    const prevChrome = originalGlobal['chrome'];
    originalGlobal['chrome'] = {
      runtime: {
        sendMessage: () => undefined,
        lastError: undefined,
      },
    };
    try {
      const t = createChromeExtensionTransport('');
      await expect(t.send({ type: 'ping', requestId: 'r1' })).rejects.toThrow(
        /extension ID not configured/,
      );
    } finally {
      if (prevChrome === undefined) {
        delete originalGlobal['chrome'];
      } else {
        originalGlobal['chrome'] = prevChrome;
      }
    }
  });
});
