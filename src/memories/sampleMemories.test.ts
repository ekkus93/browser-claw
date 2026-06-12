import { describe, expect, it } from 'vitest';
import { SAMPLE_MEMORIES, isUnmodifiedSampleMemory } from './sampleMemories.ts';

describe('sample memories', () => {
  it('are all tagged demo', () => {
    expect(SAMPLE_MEMORIES.every((m) => m.demo === true)).toBe(true);
  });
});

describe('isUnmodifiedSampleMemory', () => {
  const sample = SAMPLE_MEMORIES[0]!;

  it('recognizes an untouched seed by id/title/createdBy/source', () => {
    expect(isUnmodifiedSampleMemory(sample)).toBe(true);
    // The original (pre-demo-flag) seeded rows had no `demo` field — still a match.
    expect(
      isUnmodifiedSampleMemory({
        id: sample.id,
        title: sample.title,
        createdBy: sample.createdBy,
        source: sample.source,
      }),
    ).toBe(true);
  });

  it('does not match a seed the user edited', () => {
    expect(isUnmodifiedSampleMemory({ ...sample, title: 'My own note' })).toBe(
      false,
    );
    expect(
      isUnmodifiedSampleMemory({ ...sample, source: 'Conversation: Other' }),
    ).toBe(false);
  });

  it('does not match an unknown id', () => {
    expect(
      isUnmodifiedSampleMemory({
        id: 'user-made-this',
        title: sample.title,
        createdBy: sample.createdBy,
        source: sample.source,
      }),
    ).toBe(false);
  });
});
