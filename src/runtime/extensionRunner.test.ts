import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserClawDB } from '../db/db.ts';
import type { ExtensionTransport } from '../extension/pageReaderProvider.ts';
import {
  createExtensionEffectHandler,
  runApprovedExtensionPermission,
  type ExtensionEffectDeps,
} from './extensionRunner.ts';

const db = new BrowserClawDB();
const submit = vi.fn().mockResolvedValue(undefined);
const dispatch = vi.fn();

function makeTransport(
  send: ExtensionTransport['send'] = vi.fn(() =>
    Promise.resolve({ ok: true, requestId: 'r1', granted: true }),
  ),
): ExtensionTransport {
  return { send };
}

function deps(transport = makeTransport()): ExtensionEffectDeps {
  return { transport, db, dispatch, submit };
}

beforeEach(async () => {
  await db.open();
  await db.audit_events.clear();
  submit.mockClear();
  dispatch.mockClear();
});

afterEach(async () => {
  await db.audit_events.clear();
});

async function auditTypes(): Promise<string[]> {
  return (await db.audit_events.toArray()).map((e) => e.type);
}

describe('createExtensionEffectHandler (F3)', () => {
  it('gates a host-permission request behind approval', async () => {
    const transport = makeTransport();
    const handle = createExtensionEffectHandler(deps(transport));
    await handle({
      type: 'extension_request',
      id: 'x1',
      request: {
        type: 'request_host_permission',
        requestId: 'r1',
        origin: 'https://example.com',
      },
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'approvals/approvalRequested',
        payload: expect.objectContaining({
          id: 'x1',
          kind: 'extension_permission',
          risk: 'high',
        }),
      }),
    );
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('passes a benign request through directly', async () => {
    const transport = makeTransport(
      vi.fn(() => Promise.resolve({ ok: true, requestId: 'r2' })),
    );
    const handle = createExtensionEffectHandler(deps(transport));
    await handle({
      type: 'extension_request',
      id: 'x2',
      request: { type: 'ping', requestId: 'r2' },
    });
    expect(transport.send).toHaveBeenCalled();
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'x2',
        result: expect.objectContaining({ ok: true }),
      }),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('resolves an invalid request as a failure', async () => {
    const handle = createExtensionEffectHandler(deps());
    await handle({
      type: 'extension_request',
      id: 'x3',
      request: { type: 'bogus' },
    });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ ok: false }),
      }),
    );
  });
});

describe('runApprovedExtensionPermission (F3)', () => {
  it('sends the permission request on approval', async () => {
    const transport = makeTransport();
    await runApprovedExtensionPermission(deps(transport), {
      id: 'x4',
      status: 'approved',
      payloadPreview: JSON.stringify({
        type: 'request_host_permission',
        requestId: 'r1',
        origin: 'https://example.com',
      }),
    });
    expect(transport.send).toHaveBeenCalled();
    expect(await auditTypes()).toContain('extension.permission_requested');
  });

  it('declines on rejection and audits it', async () => {
    const transport = makeTransport();
    await runApprovedExtensionPermission(deps(transport), {
      id: 'x5',
      status: 'rejected',
      payloadPreview: JSON.stringify({
        type: 'request_host_permission',
        requestId: 'r1',
        origin: 'https://example.com',
      }),
    });
    expect(transport.send).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledWith({
      type: 'resolve_effect',
      id: 'x5',
      result: { ok: false, error: { kind: 'user_rejected' } },
    });
    expect(await auditTypes()).toContain('extension.permission_rejected');
  });
});
