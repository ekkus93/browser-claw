import { describe, expect, it } from 'vitest';
import auditReducer, {
  auditAppended,
  auditCleared,
  type AuditEntry,
} from './auditSlice.ts';

function entry(id: string, at: number): AuditEntry {
  return { id, type: 'tool_executed', summary: `event ${id}`, risk: 'low', at };
}

describe('auditSlice', () => {
  it('starts with no recent entries', () => {
    const state = auditReducer(undefined, { type: '@@INIT' });
    expect(state.recent).toEqual([]);
  });

  it('prepends newest entries and clears', () => {
    let state = auditReducer(undefined, auditAppended(entry('1', 100)));
    state = auditReducer(state, auditAppended(entry('2', 200)));
    expect(state.recent.map((e) => e.id)).toEqual(['2', '1']);
    state = auditReducer(state, auditCleared());
    expect(state.recent).toEqual([]);
  });

  it('caps the recent feed at 50 entries', () => {
    let state = auditReducer(undefined, { type: '@@INIT' });
    for (let i = 0; i < 60; i++) {
      state = auditReducer(state, auditAppended(entry(String(i), i)));
    }
    expect(state.recent).toHaveLength(50);
    // newest first
    expect(state.recent[0]?.id).toBe('59');
  });
});
