import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, process.argv[2] ?? 'release-artifacts');

function fail(message) {
  throw new Error(`Release artifact verification failed: ${message}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const config = readJson(join(root, 'release/release-config.json'));
const manifestPath = join(output, 'browserclaw-release-manifest.json');
const checksumsPath = join(output, 'SHA256SUMS');
if (!existsSync(manifestPath) || !existsSync(checksumsPath)) {
  fail('release manifest or SHA256SUMS is missing');
}

const manifest = readJson(manifestPath);
if (manifest.version !== config.version) fail('manifest version mismatch');
if (manifest.extensionId !== config.extensionId) {
  fail('manifest extension ID mismatch');
}
if (!/^[0-9a-f]{40}$/i.test(manifest.commitSha ?? '')) {
  fail('manifest commit SHA is missing or malformed');
}
if (manifest.releaseChannel !== 'rc' && manifest.releaseChannel !== 'stable') {
  fail('manifest release channel is invalid');
}
if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 2) {
  fail('manifest must describe exactly the application and extension archives');
}

const expectedChecksums = new Map();
for (const line of readFileSync(checksumsPath, 'utf8').trim().split('\n')) {
  const match = /^([0-9a-f]{64})  (.+)$/i.exec(line);
  if (!match) fail(`malformed SHA256SUMS line: ${line}`);
  expectedChecksums.set(match[2], match[1].toLowerCase());
}

for (const artifact of manifest.artifacts) {
  if (
    artifact === null ||
    typeof artifact !== 'object' ||
    typeof artifact.name !== 'string' ||
    typeof artifact.sha256 !== 'string'
  ) {
    fail('malformed artifact entry');
  }
  if (
    !/^browserclaw-(app|extension)-0\.1\.0(?:-rc\.\d+)?\.zip$/.test(
      artifact.name,
    )
  ) {
    fail(`unexpected artifact filename: ${artifact.name}`);
  }
  const path = join(output, artifact.name);
  if (!existsSync(path)) fail(`missing artifact: ${artifact.name}`);
  const actual = sha256(path);
  if (actual !== artifact.sha256)
    fail(`manifest checksum mismatch: ${artifact.name}`);
  if (expectedChecksums.get(artifact.name) !== actual) {
    fail(`SHA256SUMS mismatch: ${artifact.name}`);
  }
  if (artifact.sizeInBytes !== statSync(path).size) {
    fail(`artifact size mismatch: ${artifact.name}`);
  }
  const signature = readFileSync(path).subarray(0, 4).toString('hex');
  if (signature !== '504b0304') fail(`${artifact.name} is not a ZIP archive`);
}

const manifestChecksum = sha256(manifestPath);
if (
  expectedChecksums.get('browserclaw-release-manifest.json') !==
  manifestChecksum
) {
  fail('release manifest checksum mismatch');
}
if (expectedChecksums.size !== 3) {
  fail('SHA256SUMS contains unexpected entries');
}

console.log(
  `Verified ${manifest.artifacts.length} BrowserClaw ${manifest.version} artifacts for ${manifest.commitSha}.`,
);
