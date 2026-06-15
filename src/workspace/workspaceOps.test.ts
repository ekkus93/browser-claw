import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserClawDB } from '../db/db.ts';
import { MemoryContentStore } from './contentStore.ts';
import { WorkspaceFs } from './workspaceFs.ts';
import {
  buildWorkspaceProposal,
  classifyWorkspaceRisk,
  executeWorkspaceOp,
  rejectWorkspaceOp,
  textDiffPreview,
} from './workspaceOps.ts';

const db = new BrowserClawDB();
let fs: WorkspaceFs;
const dispatch = vi.fn();

beforeEach(async () => {
  await db.open();
  await db.workspace_files.clear();
  await db.audit_events.clear();
  fs = new WorkspaceFs({ db, content: new MemoryContentStore() });
  dispatch.mockClear();
});

afterEach(async () => {
  await db.workspace_files.clear();
  await db.audit_events.clear();
});

describe('workspace risk + diff (B6)', () => {
  it('classifies delete as high and writes/moves as medium', () => {
    expect(
      classifyWorkspaceRisk({ kind: 'delete', path: '/workspace/a' }),
    ).toBe('high');
    expect(
      classifyWorkspaceRisk({
        kind: 'create',
        path: '/workspace/a',
        content: 'x',
      }),
    ).toBe('medium');
    expect(
      classifyWorkspaceRisk({
        kind: 'move',
        from: '/workspace/a',
        to: '/workspace/b',
      }),
    ).toBe('medium');
  });

  it('produces a diff preview for an update over an existing file', async () => {
    await fs.createFile('/workspace/a.txt', 'one\ntwo\nthree');
    const proposal = await buildWorkspaceProposal(
      { fs },
      { kind: 'update', path: '/workspace/a.txt', content: 'one\nTWO\nthree' },
    );
    expect(proposal.risk).toBe('medium');
    expect(proposal.diff).toContain('- two');
    expect(proposal.diff).toContain('+ TWO');
  });

  it('textDiffPreview marks added/removed lines', () => {
    const diff = textDiffPreview('a\nb', 'a\nc');
    expect(diff).toContain('- b');
    expect(diff).toContain('+ c');
    expect(diff).not.toContain('a');
  });
});

describe('workspace execute/reject + audit (B6)', () => {
  it('an approved create performs the write and audits file_created', async () => {
    await executeWorkspaceOp(
      { fs, db, dispatch },
      { kind: 'create', path: '/workspace/a.txt', content: 'hi' },
    );
    expect(await fs.readText('/workspace/a.txt')).toBe('hi');
    const rows = await db.audit_events
      .where('type')
      .equals('workspace.file_created')
      .toArray();
    expect(rows[0]?.status).toBe('success');
  });

  it('an approved delete removes the file and audits file_deleted', async () => {
    await fs.createFile('/workspace/a.txt', 'hi');
    await executeWorkspaceOp(
      { fs, db, dispatch },
      { kind: 'delete', path: '/workspace/a.txt' },
    );
    expect(await fs.exists('/workspace/a.txt')).toBe(false);
    expect(
      (
        await db.audit_events
          .where('type')
          .equals('workspace.file_deleted')
          .toArray()
      ).length,
    ).toBe(1);
  });

  it('a rejected op performs nothing and audits permission_denied', async () => {
    rejectWorkspaceOp(
      { fs, db, dispatch },
      { kind: 'create', path: '/workspace/a.txt', content: 'hi' },
    );
    expect(await fs.exists('/workspace/a.txt')).toBe(false);
    await vi.waitFor(async () => {
      const rows = await db.audit_events
        .where('type')
        .equals('workspace.permission_denied')
        .toArray();
      expect(rows[0]?.status).toBe('rejected');
    });
  });
});
