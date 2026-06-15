import 'fake-indexeddb/auto';
import { configureStore, createListenerMiddleware } from '@reduxjs/toolkit';
import { describe, expect, it, vi } from 'vitest';
import chatReducer, {
  userMessageSubmitted,
  activeSkillSet,
} from '../store/slices/chatSlice.ts';
import approvalsReducer, {
  approvalRequested,
  approvalResolved,
  approvalEdited,
} from '../store/slices/approvalsSlice.ts';
import { registerRuntimeListeners } from './runtimeListeners.ts';
import type { RuntimeHost } from './runtimeHost.ts';
import { BrowserClawDB } from '../db/db.ts';

const db = new BrowserClawDB();

function setup(
  deps: Partial<Parameters<typeof registerRuntimeListeners>[2]> = {},
) {
  const submit = vi.fn<RuntimeHost['submit']>().mockResolvedValue(undefined);
  const host = { submit } as unknown as RuntimeHost;
  const listener = createListenerMiddleware();
  const store = configureStore({
    reducer: { chat: chatReducer, approvals: approvalsReducer },
    middleware: (getDefault) => getDefault().prepend(listener.middleware),
  });
  registerRuntimeListeners(listener.startListening as never, host, {
    db,
    ...deps,
  });
  return { submit, store };
}

describe('registerRuntimeListeners', () => {
  it('submits a runtime command when a user message is dispatched', async () => {
    const { submit, store } = setup();

    store.dispatch(
      userMessageSubmitted({ conversationId: 'c1', text: 'hello' }),
    );
    // reducer moves the run state immediately
    expect(store.getState().chat.runState).toBe('thinking');

    // the listener drives the host asynchronously
    await vi.waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit).toHaveBeenCalledWith({
      type: 'submit_user_message',
      conversation_id: 'c1',
      text: 'hello',
      skill_id: '',
    });
  });

  it('attributes the turn to the chat active skill', async () => {
    const { submit, store } = setup();
    store.dispatch(activeSkillSet('web-search'));

    store.dispatch(userMessageSubmitted({ conversationId: 'c1', text: 'hi' }));

    await vi.waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ skill_id: 'web-search' }),
    );
  });

  it('resolves a rejected tool-call approval back into the runtime', async () => {
    const { submit, store } = setup();
    store.dispatch(
      approvalRequested({
        id: 'eff-3',
        kind: 'tool_call',
        title: 'Page Reader',
        risk: 'medium',
        summary: 'Tool call: Page Reader',
        payloadPreview: '{}',
        toolName: 'Page Reader',
      }),
    );

    store.dispatch(approvalResolved({ id: 'eff-3', status: 'rejected' }));

    await vi.waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit).toHaveBeenCalledWith({
      type: 'resolve_effect',
      id: 'eff-3',
      result: { ok: false, error: { kind: 'user_rejected' } },
    });
  });

  it('routes a plan approval to the plan resolver (F3)', async () => {
    const resolvePlanApproval = vi.fn().mockResolvedValue(undefined);
    const { store } = setup({ resolvePlanApproval });
    store.dispatch(
      approvalRequested({
        id: 'plan-1',
        kind: 'plan',
        title: 'P',
        risk: 'medium',
        summary: 'a plan',
        payloadPreview: '{"type":"browserclaw_plan"}',
      }),
    );
    store.dispatch(approvalResolved({ id: 'plan-1', status: 'approved' }));
    await vi.waitFor(() => expect(resolvePlanApproval).toHaveBeenCalled());
    expect(resolvePlanApproval).toHaveBeenCalledWith({
      id: 'plan-1',
      status: 'approved',
      payloadPreview: '{"type":"browserclaw_plan"}',
    });
  });

  it('routes a sandbox-script approval to the sandbox resolver (F3)', async () => {
    const resolveSandboxApproval = vi.fn().mockResolvedValue(undefined);
    const { store } = setup({ resolveSandboxApproval });
    store.dispatch(
      approvalRequested({
        id: 'sbx-1',
        kind: 'sandbox_script',
        title: 'S',
        risk: 'high',
        summary: 'a script',
        payloadPreview: '{"type":"browserclaw_script_request"}',
      }),
    );
    store.dispatch(approvalResolved({ id: 'sbx-1', status: 'rejected' }));
    await vi.waitFor(() => expect(resolveSandboxApproval).toHaveBeenCalled());
    expect(resolveSandboxApproval).toHaveBeenCalledWith({
      id: 'sbx-1',
      status: 'rejected',
      payloadPreview: '{"type":"browserclaw_script_request"}',
    });
  });

  it('routes a workspace approval to the workspace resolver (F3)', async () => {
    const resolveWorkspaceApproval = vi.fn().mockResolvedValue(undefined);
    const { store } = setup({ resolveWorkspaceApproval });
    store.dispatch(
      approvalRequested({
        id: 'ws-1',
        kind: 'workspace_delete',
        title: 'W',
        risk: 'high',
        summary: 'delete a file',
        payloadPreview: '{"kind":"delete","path":"/workspace/a.md"}',
      }),
    );
    store.dispatch(approvalResolved({ id: 'ws-1', status: 'approved' }));
    await vi.waitFor(() => expect(resolveWorkspaceApproval).toHaveBeenCalled());
    expect(resolveWorkspaceApproval).toHaveBeenCalledWith({
      id: 'ws-1',
      status: 'approved',
      payloadPreview: '{"kind":"delete","path":"/workspace/a.md"}',
    });
  });

  it('audits an edit to a tool-call approval', async () => {
    await db.open();
    await db.audit_events.clear();
    const { store } = setup();
    store.dispatch(
      approvalRequested({
        id: 'eff-9',
        kind: 'tool_call',
        title: 'Page Reader',
        risk: 'medium',
        summary: 'Tool call: Page Reader',
        payloadPreview: '{}',
        toolName: 'Page Reader',
      }),
    );

    store.dispatch(
      approvalEdited({ id: 'eff-9', payloadPreview: '{"url":"https://y"}' }),
    );

    await vi.waitFor(async () => {
      const edits = await db.audit_events
        .where('type')
        .equals('tool.edited')
        .toArray();
      expect(edits.length).toBeGreaterThan(0);
    });
  });
});
