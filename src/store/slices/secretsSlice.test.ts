import { describe, expect, it } from 'vitest';
import secretsReducer, {
  vaultLockedSet,
  secretMetadataUpserted,
  secretMetadataRemoved,
} from './secretsSlice.ts';

describe('secretsSlice', () => {
  it('starts locked with no secrets', () => {
    const state = secretsReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual({ vaultLocked: true, secrets: [] });
  });

  it('tracks lock state and upserts/removes metadata', () => {
    let state = secretsReducer(undefined, vaultLockedSet(false));
    expect(state.vaultLocked).toBe(false);

    state = secretsReducer(
      state,
      secretMetadataUpserted({
        id: 'anthropic',
        label: 'Anthropic key',
        storageMode: 'encrypted',
      }),
    );
    expect(state.secrets).toHaveLength(1);

    // upsert updates in place rather than duplicating
    state = secretsReducer(
      state,
      secretMetadataUpserted({
        id: 'anthropic',
        label: 'Anthropic (prod)',
        storageMode: 'session',
      }),
    );
    expect(state.secrets).toHaveLength(1);
    expect(state.secrets[0]?.label).toBe('Anthropic (prod)');

    state = secretsReducer(state, secretMetadataRemoved('anthropic'));
    expect(state.secrets).toHaveLength(0);
  });

  it('GUARD: stored metadata never carries decrypted secret material', () => {
    const state = secretsReducer(
      undefined,
      secretMetadataUpserted({
        id: 'openai',
        label: 'OpenAI key',
        storageMode: 'encrypted',
      }),
    );
    const stored = state.secrets[0]!;
    // The metadata shape must expose no plaintext/ciphertext/value-bearing keys.
    const forbidden = [
      'value',
      'key',
      'secret',
      'token',
      'plaintext',
      'apiKey',
    ];
    for (const field of forbidden) {
      expect(Object.prototype.hasOwnProperty.call(stored, field)).toBe(false);
    }
    expect(Object.keys(stored).sort()).toEqual(['id', 'label', 'storageMode']);
  });
});
