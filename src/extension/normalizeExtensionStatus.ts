/**
 * E1 (FIX3): Normalize raw get_status response + key/vault state into
 * per-capability boolean facts. Used by Settings UI and status hooks.
 */

export type WebResearchCapabilityStatus = {
  extensionConnected: boolean;
  pageReadingSupported: boolean;
  hostPermissionFlowSupported: boolean;
  currentTabSupported: boolean;
  webSearchHandlerSupported: boolean;
  braveKeyConfigured: boolean;
  vaultLocked: boolean;
  liveSearchReady: boolean;
};

export function normalizeExtensionStatus(args: {
  rawStatus: unknown;
  braveKeyConfigured: boolean;
  vaultLocked: boolean;
}): WebResearchCapabilityStatus {
  const raw = args.rawStatus as Record<string, unknown> | null | undefined;
  const extensionConnected = raw?.['ok'] === true;

  const caps = (
    extensionConnected && raw?.['capabilities'] != null
      ? (raw['capabilities'] as Record<string, unknown>)
      : {}
  ) as Record<string, Record<string, unknown>>;

  const readPage = caps['readPage'] ?? {};
  const readCurrentTab = caps['readCurrentTab'] ?? {};
  const webSearch = caps['webSearch'] ?? {};

  const pageReadingSupported =
    readPage['supported'] === true || raw?.['pageReadingAvailable'] === true;
  const hostPermissionFlowSupported =
    readPage['permissionRequestSupported'] === true;
  const currentTabSupported =
    readCurrentTab['supported'] === true ||
    raw?.['currentTabReadingAvailable'] === true;
  const webSearchHandlerSupported =
    webSearch['supported'] === true || raw?.['webSearchAvailable'] === true;

  return {
    extensionConnected,
    pageReadingSupported,
    hostPermissionFlowSupported,
    currentTabSupported,
    webSearchHandlerSupported,
    braveKeyConfigured: args.braveKeyConfigured,
    vaultLocked: args.vaultLocked,
    liveSearchReady:
      extensionConnected &&
      webSearchHandlerSupported &&
      args.braveKeyConfigured &&
      !args.vaultLocked,
  };
}
