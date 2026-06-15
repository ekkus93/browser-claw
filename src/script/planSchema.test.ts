import { describe, expect, it } from 'vitest';
import {
  MAX_PLAN_STEPS,
  planCapabilities,
  validatePlan,
  type BrowserClawPlan,
} from './planSchema.ts';

function plan(steps: unknown[]): unknown {
  return {
    type: 'browserclaw_plan',
    version: 1,
    title: 'Research OPFS',
    reason: 'summarize OPFS guidance',
    steps,
  };
}

describe('validatePlan (C1)', () => {
  it('accepts a well-formed plan and derives capabilities', () => {
    const result = validatePlan(
      plan([
        { id: 'search', op: 'web.search', query: 'opfs', maxResults: 5 },
        {
          id: 'read0',
          op: 'web.readPage',
          urlFrom: 'search.results[0].url',
          maxChars: 50_000,
        },
        {
          id: 'write',
          op: 'fs.writeText',
          path: '/workspace/research/opfs.md',
          contentFrom: 'read0.markdown',
        },
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(planCapabilities(result.plan)).toEqual([
        'web.readPage',
        'web.search',
        'workspace.write',
      ]);
    }
  });

  it('rejects an unknown op', () => {
    const result = validatePlan(plan([{ id: 'a', op: 'fs.launchMissiles' }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/unknown op/i);
  });

  it('rejects duplicate step ids', () => {
    const result = validatePlan(
      plan([
        { id: 'a', op: 'fs.list', path: '/workspace' },
        { id: 'a', op: 'fs.list', path: '/workspace' },
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.join(' ')).toMatch(/duplicate step id/i);
  });

  it('rejects an unsafe workspace path', () => {
    const result = validatePlan(
      plan([{ id: 'a', op: 'fs.writeText', path: '/workspace/../escape' }]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.join(' ')).toMatch(/safe workspace path/i);
  });

  it('rejects an input reference to an unknown or later step', () => {
    const result = validatePlan(
      plan([
        {
          id: 'write',
          op: 'fs.writeText',
          path: '/workspace/a.md',
          contentFrom: 'later.text',
        },
        { id: 'later', op: 'fs.readText', path: '/workspace/b.md' },
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.join(' ')).toMatch(/unknown or later step/i);
  });

  it('rejects an unsafe literal URL', () => {
    const result = validatePlan(
      plan([{ id: 'r', op: 'web.readPage', url: 'http://169.254.169.254/' }]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/allowed URL/i);
  });

  it('rejects an excessive step count', () => {
    const steps = Array.from({ length: MAX_PLAN_STEPS + 1 }, (_v, i) => ({
      id: `s${i}`,
      op: 'fs.list' as const,
      path: '/workspace',
    }));
    const result = validatePlan(plan(steps));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/too many steps/i);
  });

  it('rejects a non-plan object and a bad version', () => {
    expect(validatePlan(null).ok).toBe(false);
    expect(validatePlan({ type: 'x' }).ok).toBe(false);
    const badVersion = validatePlan({
      type: 'browserclaw_plan',
      version: 99,
      title: 't',
      reason: 'r',
      steps: [{ id: 'a', op: 'fs.list', path: '/workspace' }],
    });
    expect(badVersion.ok).toBe(false);
  });

  it('enforces output ceilings', () => {
    const result = validatePlan(
      plan([{ id: 's', op: 'web.search', query: 'x', maxResults: 9999 }]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/maxResults/i);
  });
});

describe('planCapabilities', () => {
  it('maps fs reads/writes, web, memory, and tool ops', () => {
    const p: BrowserClawPlan = {
      type: 'browserclaw_plan',
      version: 1,
      title: 't',
      reason: 'r',
      steps: [
        { id: 'a', op: 'fs.readText', path: '/workspace/a' },
        { id: 'b', op: 'memory.create' },
        { id: 'c', op: 'tool.call' },
      ],
    };
    expect(planCapabilities(p)).toEqual([
      'memory.write',
      'skill.tool',
      'workspace.read',
    ]);
  });
});
