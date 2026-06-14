import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import auditReducer from '../store/slices/auditSlice.ts';
import approvalsReducer from '../store/slices/approvalsSlice.ts';
import { BrowserClawDB } from '../db/db.ts';
import { createToolEffectHandler } from './toolRunner.ts';
import type { Effect } from './effectTypes.ts';

const db = new BrowserClawDB();

function makeHandler() {
  const store = configureStore({
    reducer: { audit: auditReducer, approvals: approvalsReducer },
  });
  const submit = vi
    .fn<(command: unknown) => Promise<void>>()
    .mockResolvedValue(undefined);
  const handler = createToolEffectHandler({
    db,
    dispatch: store.dispatch,
    submit,
  });
  return { store, submit, handler };
}

function proposal(
  skillId: string,
  name: string,
): Extract<Effect, { type: 'tool_call_proposal' }> {
  return {
    type: 'tool_call_proposal',
    id: 'eff-1',
    skill_id: skillId,
    name,
    args: { url: 'https://example.com' },
    risk: 'medium',
  };
}

async function installSkill(opts: {
  id: string;
  enabled: boolean;
  tools: string[];
}) {
  await db.skills.put({
    id: opts.id,
    name: opts.id,
    version: '1.0.0',
    description: '',
    source: 'skill_md',
    enabled: opts.enabled,
    installedAt: 1,
  });
  await db.skill_state.put({
    skillId: opts.id,
    key: '__permissions__',
    value: { tools: opts.tools, read: [], write: [], network: false },
  });
}

afterEach(async () => {
  await db.open();
  await db.skills.clear();
  await db.skill_state.clear();
  await db.audit_events.clear();
});

describe('createToolEffectHandler — permission enforcement (fail closed)', () => {
  it('queues the call for approval when the skill declared the tool', async () => {
    await db.open();
    await installSkill({
      id: 'web-search',
      enabled: true,
      tools: ['Page Reader'],
    });
    const { store, submit, handler } = makeHandler();

    await handler(proposal('web-search', 'Page Reader'));

    expect(store.getState().approvals.queue[0]).toMatchObject({
      id: 'eff-1',
      kind: 'tool_call',
      status: 'pending',
    });
    // Nothing resolved/ran — it awaits the user's approval.
    expect(submit).not.toHaveBeenCalled();
  });

  it('denies a tool the skill did not declare (audited + resolved failure)', async () => {
    await db.open();
    await installSkill({
      id: 'web-search',
      enabled: true,
      tools: ['File Reader'],
    });
    const { store, submit, handler } = makeHandler();

    await handler(proposal('web-search', 'Page Reader'));

    expect(store.getState().approvals.queue).toHaveLength(0);
    expect(submit).toHaveBeenCalledWith({
      type: 'resolve_effect',
      id: 'eff-1',
      result: {
        ok: false,
        error: expect.objectContaining({ kind: 'tool_not_permitted' }),
      },
    });
    const denied = await db.audit_events
      .where('type')
      .equals('tool.denied')
      .toArray();
    expect(denied[0]?.status).toBe('failure');
    expect(denied[0]?.toolName).toBe('Page Reader');
  });

  it('denies a disabled skill', async () => {
    await db.open();
    await installSkill({
      id: 'web-search',
      enabled: false,
      tools: ['Page Reader'],
    });
    const { submit, handler } = makeHandler();
    await handler(proposal('web-search', 'Page Reader'));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'resolve_effect' }),
    );
  });

  it('denies an unknown skill and a call with no active skill', async () => {
    await db.open();
    const { submit, handler } = makeHandler();
    await handler(proposal('ghost', 'Page Reader'));
    await handler(proposal('', 'Page Reader'));
    expect(submit).toHaveBeenCalledTimes(2);
  });
});
