import { describe, expect, it } from 'vitest';
import approvalsReducer, {
  approvalRequested,
  approvalEdited,
  approvalResolved,
  approvalDismissed,
  type ApprovalRequest,
} from './approvalsSlice.ts';

const baseRequest: Omit<ApprovalRequest, 'status'> = {
  id: 'a1',
  kind: 'storage_write',
  title: 'Write memory',
  risk: 'low',
  summary: 'Persist a new memory record',
  payloadPreview: '{"text":"remember this"}',
};

describe('approvalsSlice', () => {
  it('starts with an empty queue', () => {
    const state = approvalsReducer(undefined, { type: '@@INIT' });
    expect(state.queue).toEqual([]);
  });

  it('enqueues a proposed effect as pending', () => {
    const state = approvalsReducer(undefined, approvalRequested(baseRequest));
    expect(state.queue).toHaveLength(1);
    expect(state.queue[0]).toMatchObject({ id: 'a1', status: 'pending' });
  });

  it('edits the payload preview before resolution', () => {
    let state = approvalsReducer(undefined, approvalRequested(baseRequest));
    state = approvalsReducer(
      state,
      approvalEdited({ id: 'a1', payloadPreview: '{"text":"edited"}' }),
    );
    expect(state.queue[0]?.payloadPreview).toBe('{"text":"edited"}');
  });

  it('resolves and dismisses an approval', () => {
    let state = approvalsReducer(undefined, approvalRequested(baseRequest));
    state = approvalsReducer(
      state,
      approvalResolved({ id: 'a1', status: 'approved' }),
    );
    expect(state.queue[0]?.status).toBe('approved');
    state = approvalsReducer(state, approvalDismissed('a1'));
    expect(state.queue).toHaveLength(0);
  });
});
