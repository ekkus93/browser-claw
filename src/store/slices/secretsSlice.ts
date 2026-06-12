import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * Secrets METADATA ONLY.
 *
 * This slice must never hold decrypted API keys or OAuth tokens — no plaintext,
 * ciphertext-to-be-displayed, or key bytes of any kind. Decrypted secrets live
 * solely in the in-memory SecretVault (Phase 4); encrypted blobs live in Dexie.
 * Redux only tracks which secrets exist, their storage mode, and lock status,
 * so the UI can render the security screen and gate actions.
 *
 * `SecretMetadata` intentionally has NO value field. See secretsSlice.test.ts
 * for the guard that enforces this.
 */
export type SecretStorageMode = 'session' | 'encrypted';

export interface SecretMetadata {
  id: string;
  label: string;
  storageMode: SecretStorageMode;
}

export interface SecretsState {
  vaultLocked: boolean;
  secrets: SecretMetadata[];
}

const initialState: SecretsState = {
  vaultLocked: true,
  secrets: [],
};

const secretsSlice = createSlice({
  name: 'secrets',
  initialState,
  reducers: {
    vaultLockedSet(state, action: PayloadAction<boolean>) {
      state.vaultLocked = action.payload;
    },
    secretMetadataUpserted(state, action: PayloadAction<SecretMetadata>) {
      const existing = state.secrets.find((s) => s.id === action.payload.id);
      if (existing) {
        existing.label = action.payload.label;
        existing.storageMode = action.payload.storageMode;
      } else {
        state.secrets.push(action.payload);
      }
    },
    secretMetadataRemoved(state, action: PayloadAction<string>) {
      state.secrets = state.secrets.filter((s) => s.id !== action.payload);
    },
  },
});

export const { vaultLockedSet, secretMetadataUpserted, secretMetadataRemoved } =
  secretsSlice.actions;
export default secretsSlice.reducer;
