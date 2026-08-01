import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const strict = process.argv.includes('--strict');

function readJson(path) {
  return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
}

function fail(message) {
  throw new Error(`Release configuration invalid: ${message}`);
}

function requireEqual(label, actual, expected) {
  if (actual !== expected) {
    fail(`${label} is ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}`);
  }
}

function extensionIdFromKey(key) {
  const digest = createHash('sha256')
    .update(Buffer.from(key, 'base64'))
    .digest()
    .subarray(0, 16);
  const alphabet = 'abcdefghijklmnop';
  return [...digest]
    .map((byte) => `${alphabet[byte >> 4]}${alphabet[byte & 0x0f]}`)
    .join('');
}

function isEnabled(value) {
  return value === 'true' || value === '1';
}

const packageJson = readJson('package.json');
const releaseConfig = readJson('release/release-config.json');
const manifest = readJson('extension/chrome-web-research/manifest.json');

requireEqual('package version', packageJson.version, releaseConfig.version);
requireEqual('extension version', manifest.version, releaseConfig.version);
requireEqual(
  'extension version_name',
  manifest.version_name,
  releaseConfig.rcVersionName,
);
requireEqual('extension manifest key', manifest.key, releaseConfig.extensionPublicKey);
requireEqual(
  'extension ID derived from manifest key',
  extensionIdFromKey(manifest.key),
  releaseConfig.extensionId,
);

const expectedProductionMatch = `${releaseConfig.productionOrigin}${releaseConfig.productionBasePath}*`;
const matches = manifest.externally_connectable?.matches;
if (!Array.isArray(matches) || !matches.includes(expectedProductionMatch)) {
  fail(`externally_connectable.matches must include ${expectedProductionMatch}`);
}
if (
  matches.some(
    (match) =>
      match === '<all_urls>' ||
      match.startsWith('*://') ||
      match.includes('://*.') ||
      match === 'http://*/*' ||
      match === 'https://*/*',
  )
) {
  fail('externally_connectable.matches contains a broad wildcard origin');
}

if (strict) {
  const required = {
    VITE_CHROME_EXTENSION_ID: releaseConfig.extensionId,
    VITE_RELEASE_VERSION: releaseConfig.version,
    VITE_BASE_PATH: releaseConfig.productionBasePath,
  };
  for (const [name, expected] of Object.entries(required)) {
    requireEqual(name, process.env[name], expected);
  }

  const channel = process.env.VITE_RELEASE_CHANNEL;
  if (channel !== 'rc' && channel !== 'stable') {
    fail('VITE_RELEASE_CHANNEL must be rc or stable for a release build');
  }

  const gitSha = process.env.VITE_GIT_SHA ?? '';
  if (!/^[0-9a-f]{40}$/i.test(gitSha)) {
    fail('VITE_GIT_SHA must be a full 40-character commit SHA');
  }

  const buildUtc = process.env.VITE_BUILD_UTC ?? '';
  if (
    buildUtc.length === 0 ||
    Number.isNaN(Date.parse(buildUtc)) ||
    !buildUtc.endsWith('Z')
  ) {
    fail('VITE_BUILD_UTC must be an ISO-8601 UTC timestamp ending in Z');
  }

  for (const name of [
    'VITE_DEMO_MODE',
    'VITE_ALLOW_REFERENCE_RUNTIME_FALLBACK',
    'VITE_ALLOW_MOCK_PROVIDER',
  ]) {
    if (isEnabled(process.env[name])) {
      fail(`${name} must be absent or false in a release build`);
    }
  }
}

console.log(
  `Release configuration valid: BrowserClaw ${releaseConfig.version}, extension ${releaseConfig.extensionId}${strict ? ', strict release mode' : ''}.`,
);
