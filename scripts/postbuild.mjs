import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const strict = process.argv.includes('--strict');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

function fail(message) {
  throw new Error(`Post-build validation failed: ${message}`);
}

function isEnabled(value) {
  return value === 'true' || value === '1';
}

function listFiles(directory) {
  const result = [];
  const visit = (current) => {
    for (const name of readdirSync(current).sort()) {
      const absolute = join(current, name);
      if (statSync(absolute).isDirectory()) {
        visit(absolute);
      } else {
        result.push(relative(directory, absolute).replaceAll('\\', '/'));
      }
    }
  };
  visit(directory);
  return result;
}

if (!existsSync(join(dist, 'index.html'))) {
  fail('dist/index.html is missing');
}

const packageJson = readJson('package.json');
const releaseConfig = readJson('release/release-config.json');
const releaseVersion = process.env.VITE_RELEASE_VERSION ?? packageJson.version;
const gitSha = process.env.VITE_GIT_SHA ?? 'development';
const buildUtc = process.env.VITE_BUILD_UTC ?? new Date().toISOString();
const releaseChannel = process.env.VITE_RELEASE_CHANNEL ?? 'development';
const basePath = process.env.VITE_BASE_PATH ?? '/';
const extensionId =
  process.env.VITE_CHROME_EXTENSION_ID ?? releaseConfig.extensionId;

if (strict) {
  if (releaseVersion !== releaseConfig.version) fail('release version mismatch');
  if (!/^[0-9a-f]{40}$/i.test(gitSha)) fail('full commit SHA is required');
  if (releaseChannel !== 'rc' && releaseChannel !== 'stable') {
    fail('release channel must be rc or stable');
  }
  if (basePath !== releaseConfig.productionBasePath) fail('base path mismatch');
  if (extensionId !== releaseConfig.extensionId) fail('extension ID mismatch');
}

const safetyOverrides = {
  demoMode: isEnabled(process.env.VITE_DEMO_MODE),
  referenceRuntimeFallback: isEnabled(
    process.env.VITE_ALLOW_REFERENCE_RUNTIME_FALLBACK,
  ),
  mockProvider: isEnabled(process.env.VITE_ALLOW_MOCK_PROVIDER),
};
if (strict && Object.values(safetyOverrides).some(Boolean)) {
  fail('a production safety override is enabled');
}

const files = listFiles(dist);
if (!files.some((path) => path.endsWith('.wasm'))) {
  fail('the production output contains no WebAssembly asset');
}
if (!files.some((path) => path.endsWith('.js'))) {
  fail('the production output contains no JavaScript asset');
}
if (!files.some((path) => path.endsWith('.css'))) {
  fail('the production output contains no CSS asset');
}

// GitHub Pages serves 404.html for unknown paths. Duplicating the SPA entry
// point preserves direct navigation and refresh for BrowserClaw routes.
cpSync(join(dist, 'index.html'), join(dist, '404.html'));
writeFileSync(
  join(dist, 'release-metadata.json'),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      product: releaseConfig.product,
      version: releaseVersion,
      commitSha: gitSha,
      buildUtc,
      releaseChannel,
      basePath,
      extensionId,
      productionUrl: releaseConfig.productionUrl,
      runtimePolicy: 'wasm-required-fail-closed',
      safetyOverrides,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

console.log(
  `Post-build validation complete: ${releaseVersion} ${releaseChannel} ${gitSha.slice(0, 12)}.`,
);
