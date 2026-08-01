import { describe, expect, it } from 'vitest';
import { parseBuildMetadata } from './buildMetadata.ts';

const VALID = {
  version: '0.1.0',
  gitSha: '0123456789abcdef0123456789abcdef01234567',
  buildUtc: '2026-08-01T20:00:00Z',
  releaseChannel: 'rc',
  extensionId: 'abcdefghijklmnopabcdefghijklmnop',
} as const;

describe('parseBuildMetadata', () => {
  it('returns immutable release identity fields and a short SHA', () => {
    expect(parseBuildMetadata(VALID)).toEqual({
      ...VALID,
      shortGitSha: '0123456789ab',
    });
  });

  it('permits explicit development metadata', () => {
    expect(
      parseBuildMetadata({
        ...VALID,
        gitSha: 'development',
        releaseChannel: 'development',
      }).shortGitSha,
    ).toBe('development');
  });

  it.each([
    ['version', { ...VALID, version: 'v0.1.0' }],
    ['gitSha', { ...VALID, gitSha: 'deadbeef' }],
    ['buildUtc', { ...VALID, buildUtc: 'not-a-date' }],
    ['releaseChannel', { ...VALID, releaseChannel: 'preview' }],
    ['extensionId', { ...VALID, extensionId: 'invalid' }],
  ])('rejects malformed %s metadata', (_field, raw) => {
    expect(() => parseBuildMetadata(raw)).toThrow(/Build metadata/);
  });
});
