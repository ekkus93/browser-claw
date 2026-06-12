import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * Live recent-audit feed for the inspector and audit screen. The durable,
 * complete audit log lives in Dexie (Phase 3 / functionality in Phase 12); this
 * slice keeps a capped tail in memory for live display.
 *
 * Audit payloads must never contain decrypted secrets.
 */
export type AuditRisk = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface AuditEntry {
  id: string;
  type: string;
  summary: string;
  risk: AuditRisk;
  /** Epoch ms, supplied by the caller (reducers stay deterministic). */
  at: number;
}

export interface AuditState {
  recent: AuditEntry[];
}

const MAX_RECENT = 50;

const initialState: AuditState = {
  recent: [],
};

const auditSlice = createSlice({
  name: 'audit',
  initialState,
  reducers: {
    auditAppended(state, action: PayloadAction<AuditEntry>) {
      state.recent.unshift(action.payload);
      if (state.recent.length > MAX_RECENT) {
        state.recent.length = MAX_RECENT;
      }
    },
    auditCleared(state) {
      state.recent = [];
    },
  },
});

export const { auditAppended, auditCleared } = auditSlice.actions;
export default auditSlice.reducer;
