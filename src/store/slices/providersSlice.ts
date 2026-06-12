import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * Provider connection health surfaced to the UI. Provider *profiles* (base URL,
 * model, key reference) are durable and live in Dexie (Phase 3); this slice
 * owns only the transient active selection and live health per provider.
 *
 * No secret material here — encrypted key references live in Dexie and
 * decrypted keys only in the in-memory SecretVault.
 */
export type ProviderHealth =
  | 'unconfigured'
  | 'connected'
  | 'auth_failed'
  | 'cors_error'
  | 'model_not_found'
  | 'unreachable';

export interface ProvidersState {
  activeProviderId: string | null;
  activeProviderLabel: string | null;
  /** The active provider's persisted model/base URL, for the runtime + status bar. */
  activeProviderModel: string | null;
  activeProviderBaseUrl: string | null;
  health: Record<string, ProviderHealth>;
}

const initialState: ProvidersState = {
  activeProviderId: null,
  activeProviderLabel: null,
  activeProviderModel: null,
  activeProviderBaseUrl: null,
  health: {},
};

const providersSlice = createSlice({
  name: 'providers',
  initialState,
  reducers: {
    activeProviderSet(
      state,
      action: PayloadAction<{
        id: string;
        label: string;
        model?: string;
        baseUrl?: string;
      } | null>,
    ) {
      state.activeProviderId = action.payload?.id ?? null;
      state.activeProviderLabel = action.payload?.label ?? null;
      state.activeProviderModel = action.payload?.model ?? null;
      state.activeProviderBaseUrl = action.payload?.baseUrl ?? null;
    },
    providerHealthSet(
      state,
      action: PayloadAction<{ providerId: string; health: ProviderHealth }>,
    ) {
      state.health[action.payload.providerId] = action.payload.health;
    },
  },
});

export const { activeProviderSet, providerHealthSet } = providersSlice.actions;
export default providersSlice.reducer;
