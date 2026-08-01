/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEMO_MODE?: string;
  readonly VITE_ALLOW_REFERENCE_RUNTIME_FALLBACK?: string;
  readonly VITE_ALLOW_MOCK_PROVIDER?: string;
  readonly VITE_CHROME_EXTENSION_ID?: string;
  readonly VITE_RELEASE_VERSION?: string;
  readonly VITE_GIT_SHA?: string;
  readonly VITE_BUILD_UTC?: string;
  readonly VITE_RELEASE_CHANNEL?: string;
  readonly VITE_BASE_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __BROWSERCLAW_VERSION__: string;
declare const __BROWSERCLAW_GIT_SHA__: string;
declare const __BROWSERCLAW_BUILD_UTC__: string;
declare const __BROWSERCLAW_RELEASE_CHANNEL__: string;
declare const __BROWSERCLAW_EXTENSION_ID__: string;
