import { describe, expect, it } from 'vitest';
import {
  validateHfReference,
  hfDownloadUrl,
  type HfReference,
} from './hfReference.ts';
import { MODEL_CATALOG } from './catalog.ts';

describe('validateHfReference', () => {
  it('accepts a well-formed repo id and .gguf file', () => {
    const result = validateHfReference(
      '  bartowski/SmolLM2-135M-Instruct-GGUF  ',
      ' model.gguf ',
    );
    expect(result).toEqual({
      ok: true,
      reference: {
        repo: 'bartowski/SmolLM2-135M-Instruct-GGUF',
        file: 'model.gguf',
      },
    });
  });

  it('accepts a .gguf file in a subdirectory', () => {
    expect(validateHfReference('owner/name', 'main/model.gguf').ok).toBe(true);
  });

  it('accepts every built-in catalog entry', () => {
    for (const model of MODEL_CATALOG) {
      expect(validateHfReference(model.repo, model.file).ok).toBe(true);
    }
  });

  it.each([
    ['', 'model.gguf', /repo/i],
    ['owner', 'model.gguf', /owner\/name/i], // missing name segment
    ['owner/name/extra', 'model.gguf', /owner\/name/i],
    ['https://huggingface.co/owner/name', 'model.gguf', /not a URL/i],
    ['owner name/x', 'model.gguf', /owner\/name/i], // space
    ['owner/name', '', /file name/i],
    ['owner/name', 'model.bin', /\.gguf/i], // wrong extension
    ['owner/name', '../secret.gguf', /within the repo/i], // traversal
    ['owner/name', '/etc/passwd.gguf', /within the repo/i], // absolute
    ['owner/name', 'https://evil.test/x.gguf', /within the repo/i], // url
  ])('rejects repo=%p file=%p', (repo, file, pattern) => {
    const result = validateHfReference(repo, file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(pattern);
  });
});

describe('hfDownloadUrl', () => {
  it('points at huggingface.co, never an app server', () => {
    const ref: HfReference = { repo: 'owner/name', file: 'model.gguf' };
    const url = hfDownloadUrl(ref);
    expect(url).toBe(
      'https://huggingface.co/owner/name/resolve/main/model.gguf',
    );
    expect(new URL(url).origin).toBe('https://huggingface.co');
  });
});
