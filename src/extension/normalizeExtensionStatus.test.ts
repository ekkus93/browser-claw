import { describe, expect, it } from 'vitest';
import { normalizeExtensionStatus } from './normalizeExtensionStatus.ts';

function statusOk(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    requestId: 'r',
    protocolVersion: 1,
    extensionVersion: '0.1.0',
    capabilities: {
      readPage: {
        supported: true,
        requiresHostPermission: true,
        permissionRequestSupported: true,
      },
      readCurrentTab: { supported: false, requiresActiveTab: true },
      webSearch: { supported: true, providerConfigured: true },
    },
    pageReadingAvailable: true,
    currentTabReadingAvailable: false,
    webSearchAvailable: true,
    ...overrides,
  };
}

describe('E1 — normalizeExtensionStatus', () => {
  it('E1: connected extension + key + vault unlocked → liveSearchReady true', () => {
    const s = normalizeExtensionStatus({
      rawStatus: statusOk(),
      braveKeyConfigured: true,
      vaultLocked: false,
    });
    expect(s.extensionConnected).toBe(true);
    expect(s.webSearchHandlerSupported).toBe(true);
    expect(s.braveKeyConfigured).toBe(true);
    expect(s.vaultLocked).toBe(false);
    expect(s.liveSearchReady).toBe(true);
  });

  it('E1: connected extension but no key → liveSearchReady false', () => {
    const s = normalizeExtensionStatus({
      rawStatus: statusOk(),
      braveKeyConfigured: false,
      vaultLocked: false,
    });
    expect(s.extensionConnected).toBe(true);
    expect(s.braveKeyConfigured).toBe(false);
    expect(s.liveSearchReady).toBe(false);
  });

  it('E1: key configured but extension missing → liveSearchReady false', () => {
    const s = normalizeExtensionStatus({
      rawStatus: {
        ok: false,
        requestId: 'r',
        error: { kind: 'extension_missing', message: '' },
      },
      braveKeyConfigured: true,
      vaultLocked: false,
    });
    expect(s.extensionConnected).toBe(false);
    expect(s.liveSearchReady).toBe(false);
  });

  it('E1: null rawStatus → all false', () => {
    const s = normalizeExtensionStatus({
      rawStatus: null,
      braveKeyConfigured: false,
      vaultLocked: false,
    });
    expect(s.extensionConnected).toBe(false);
    expect(s.pageReadingSupported).toBe(false);
    expect(s.liveSearchReady).toBe(false);
  });

  it('E1: vault locked → liveSearchReady false even with key + handler', () => {
    const s = normalizeExtensionStatus({
      rawStatus: statusOk(),
      braveKeyConfigured: true,
      vaultLocked: true,
    });
    expect(s.braveKeyConfigured).toBe(true);
    expect(s.vaultLocked).toBe(true);
    expect(s.liveSearchReady).toBe(false);
  });

  it('E1: current-tab unsupported shows currentTabSupported false, not a connection failure', () => {
    const s = normalizeExtensionStatus({
      rawStatus: statusOk(),
      braveKeyConfigured: false,
      vaultLocked: false,
    });
    expect(s.extensionConnected).toBe(true);
    expect(s.currentTabSupported).toBe(false);
  });

  it('E1: pageReadingAvailable fallback sets pageReadingSupported even without caps.readPage', () => {
    const s = normalizeExtensionStatus({
      rawStatus: { ok: true, requestId: 'r', pageReadingAvailable: true },
      braveKeyConfigured: false,
      vaultLocked: false,
    });
    expect(s.pageReadingSupported).toBe(true);
  });

  it('E1: page-reading unavailable shows pageReadingSupported false separately', () => {
    const raw = statusOk({
      capabilities: {
        readPage: {
          supported: false,
          requiresHostPermission: true,
          permissionRequestSupported: false,
        },
        readCurrentTab: { supported: false },
        webSearch: { supported: true },
      },
      pageReadingAvailable: false,
    });
    const s = normalizeExtensionStatus({
      rawStatus: raw,
      braveKeyConfigured: true,
      vaultLocked: false,
    });
    expect(s.extensionConnected).toBe(true);
    expect(s.pageReadingSupported).toBe(false);
    expect(s.webSearchHandlerSupported).toBe(true);
    expect(s.liveSearchReady).toBe(true);
  });

  it('E1: hostPermissionFlowSupported reflects permissionRequestSupported', () => {
    const s = normalizeExtensionStatus({
      rawStatus: statusOk(),
      braveKeyConfigured: false,
      vaultLocked: false,
    });
    expect(s.hostPermissionFlowSupported).toBe(true);
  });

  it('E1: webSearchAvailable fallback sets webSearchHandlerSupported', () => {
    const s = normalizeExtensionStatus({
      rawStatus: { ok: true, requestId: 'r', webSearchAvailable: true },
      braveKeyConfigured: true,
      vaultLocked: false,
    });
    expect(s.webSearchHandlerSupported).toBe(true);
    expect(s.liveSearchReady).toBe(true);
  });
});
