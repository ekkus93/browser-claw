import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * The inline approval queue. No meaningful side effect happens silently — every
 * proposed effect (tool call, storage write, LLM request, skill install,
 * network call) enters this queue and the user approves/edits/rejects it with
 * the risk and exact payload shown. Resolutions are emitted as audit events by
 * listener middleware.
 *
 * `payloadPreview` is a display-safe preview of the exact data to be
 * written/sent/executed — never raw secret material.
 */
export type ApprovalKind =
  | 'tool_call'
  | 'storage_write'
  | 'llm_request'
  | 'skill_install'
  | 'network';

export type ApprovalRisk = 'low' | 'medium' | 'high';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ApprovalRequest {
  id: string;
  kind: ApprovalKind;
  title: string;
  risk: ApprovalRisk;
  summary: string;
  payloadPreview: string;
  status: ApprovalStatus;
  /** For tool_call approvals: the tool to run and its args, set when queued. */
  toolName?: string;
  toolArgs?: unknown;
}

export interface ApprovalsState {
  queue: ApprovalRequest[];
}

const initialState: ApprovalsState = {
  queue: [],
};

const approvalsSlice = createSlice({
  name: 'approvals',
  initialState,
  reducers: {
    approvalRequested(
      state,
      action: PayloadAction<Omit<ApprovalRequest, 'status'>>,
    ) {
      state.queue.push({ ...action.payload, status: 'pending' });
    },
    approvalEdited(
      state,
      action: PayloadAction<{ id: string; payloadPreview: string }>,
    ) {
      const item = state.queue.find((r) => r.id === action.payload.id);
      if (item) item.payloadPreview = action.payload.payloadPreview;
    },
    approvalResolved(
      state,
      action: PayloadAction<{ id: string; status: 'approved' | 'rejected' }>,
    ) {
      const item = state.queue.find((r) => r.id === action.payload.id);
      if (item) item.status = action.payload.status;
    },
    approvalDismissed(state, action: PayloadAction<string>) {
      state.queue = state.queue.filter((r) => r.id !== action.payload);
    },
  },
});

export const {
  approvalRequested,
  approvalEdited,
  approvalResolved,
  approvalDismissed,
} = approvalsSlice.actions;
export default approvalsSlice.reducer;
