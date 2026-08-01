export type ReleaseChannel = 'development' | 'rc' | 'stable';

export interface BuildMetadata {
  readonly version: string;
  readonly gitSha: string;
  readonly shortGitSha: string;
  readonly buildUtc: string;
  readonly releaseChannel: ReleaseChannel;
  readonly extensionId: string;
}

export interface RawBuildMetadata {
  readonly version: unknown;
  readonly gitSha: unknown;
  readonly buildUtc: unknown;
  readonly releaseChannel: unknown;
  readonly extensionId: unknown;
}

const SEMVER = /^\d+\.\d+\.\d+$/;
const FULL_SHA = /^[0-9a-f]{40}$/i;
const EXTENSION_ID = /^[a-p]{32}$/;

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Build metadata ${field} must be a non-empty string.`);
  }
  return value;
}

export function parseBuildMetadata(raw: RawBuildMetadata): BuildMetadata {
  const version = requireString(raw.version, 'version');
  if (!SEMVER.test(version)) {
    throw new Error('Build metadata version must be semantic version x.y.z.');
  }

  const gitSha = requireString(raw.gitSha, 'gitSha');
  if (gitSha !== 'development' && !FULL_SHA.test(gitSha)) {
    throw new Error(
      'Build metadata gitSha must be development or a full 40-character SHA.',
    );
  }

  const buildUtc = requireString(raw.buildUtc, 'buildUtc');
  if (Number.isNaN(Date.parse(buildUtc)) || !buildUtc.endsWith('Z')) {
    throw new Error('Build metadata buildUtc must be an ISO-8601 UTC value.');
  }

  const releaseChannel = requireString(raw.releaseChannel, 'releaseChannel');
  if (!['development', 'rc', 'stable'].includes(releaseChannel)) {
    throw new Error(
      'Build metadata releaseChannel must be development, rc, or stable.',
    );
  }

  const extensionId = requireString(raw.extensionId, 'extensionId');
  if (!EXTENSION_ID.test(extensionId)) {
    throw new Error(
      'Build metadata extensionId must be a 32-character Chrome extension ID.',
    );
  }

  return {
    version,
    gitSha,
    shortGitSha: gitSha === 'development' ? gitSha : gitSha.slice(0, 12),
    buildUtc,
    releaseChannel: releaseChannel as ReleaseChannel,
    extensionId,
  };
}

export const BUILD_METADATA = parseBuildMetadata({
  version: __BROWSERCLAW_VERSION__,
  gitSha: __BROWSERCLAW_GIT_SHA__,
  buildUtc: __BROWSERCLAW_BUILD_UTC__,
  releaseChannel: __BROWSERCLAW_RELEASE_CHANNEL__,
  extensionId: __BROWSERCLAW_EXTENSION_ID__,
});
