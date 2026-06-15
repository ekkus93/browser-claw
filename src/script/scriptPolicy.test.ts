import { describe, expect, it } from 'vitest';
import {
  classifyCapabilityRisk,
  DEFAULT_SCRIPT_POLICY,
  PLAN_DSL_RUNTIME,
  routeScript,
  SANDBOXED_SCRIPT_RUNTIME,
  type ScriptCapabilities,
  type ScriptExecutionPolicy,
} from './scriptPolicy.ts';

const ENABLED: ScriptExecutionPolicy = {
  defaultRuntime: PLAN_DSL_RUNTIME,
  sandboxedScriptingEnabled: true,
  advancedMode: true,
};

const READ_ONLY: ScriptCapabilities = {
  fsRead: ['/workspace/docs/**'],
  network: 'deny',
  secrets: 'deny',
};

describe('routeScript — defaults (D1)', () => {
  it('defaults to the Plan DSL when there is no escalation', () => {
    expect(routeScript({ fitsKnownOps: false })).toEqual({
      runtime: PLAN_DSL_RUNTIME,
    });
    expect(DEFAULT_SCRIPT_POLICY.defaultRuntime).toBe(PLAN_DSL_RUNTIME);
  });

  it('routes a task that fits known ops to v0.1 even with an escalation', () => {
    const decision = routeScript({
      fitsKnownOps: true,
      escalation: { reason: 'r', capabilities: READ_ONLY },
    });
    expect(decision).toEqual({ runtime: PLAN_DSL_RUNTIME });
  });
});

describe('routeScript — v0.2 gating (D1)', () => {
  it('rejects v0.2 when sandboxed scripting is disabled (default policy)', () => {
    const decision = routeScript({
      fitsKnownOps: false,
      escalation: { reason: 'need loops', capabilities: READ_ONLY },
    });
    expect(decision).toMatchObject({ runtime: null, rejected: true });
  });

  it('rejects v0.2 when enabled but advanced mode is off', () => {
    const decision = routeScript(
      {
        fitsKnownOps: false,
        escalation: { reason: 'need loops', capabilities: READ_ONLY },
      },
      {
        defaultRuntime: PLAN_DSL_RUNTIME,
        sandboxedScriptingEnabled: true,
        advancedMode: false,
      },
    );
    expect(decision).toMatchObject({ runtime: null, rejected: true });
  });

  it('rejects a v0.2 request that omits a reason', () => {
    const decision = routeScript(
      {
        fitsKnownOps: false,
        escalation: { reason: '  ', capabilities: READ_ONLY },
      },
      ENABLED,
    );
    expect(decision).toMatchObject({ runtime: null, rejected: true });
    expect((decision as { reason: string }).reason).toMatch(/reason/);
  });

  it('rejects a v0.2 request with no capability manifest', () => {
    const decision = routeScript(
      { fitsKnownOps: false, escalation: { reason: 'need loops' } },
      ENABLED,
    );
    expect(decision).toMatchObject({ runtime: null, rejected: true });
  });

  it('rejects a v0.2 request that asks for secrets', () => {
    const decision = routeScript(
      {
        fitsKnownOps: false,
        escalation: {
          reason: 'need loops',
          capabilities: {
            ...READ_ONLY,
            secrets: 'allow' as unknown as 'deny',
          },
        },
      },
      ENABLED,
    );
    expect(decision).toMatchObject({ runtime: null, rejected: true });
  });

  it('allows a well-formed v0.2 request, always requiring approval', () => {
    const decision = routeScript(
      {
        fitsKnownOps: false,
        escalation: {
          reason: 'need custom aggregation',
          capabilities: READ_ONLY,
        },
      },
      ENABLED,
    );
    expect(decision).toMatchObject({
      runtime: SANDBOXED_SCRIPT_RUNTIME,
      requiresApproval: true,
      risk: 'low',
    });
  });

  it('marks broad workspace write scopes as high risk', () => {
    const decision = routeScript(
      {
        fitsKnownOps: false,
        escalation: {
          reason: 'rewrite everything',
          capabilities: { fsWrite: ['/workspace/**'], network: 'deny' },
        },
      },
      ENABLED,
    );
    expect(decision).toMatchObject({
      runtime: SANDBOXED_SCRIPT_RUNTIME,
      risk: 'high',
    });
  });

  it('honors an explicit user request to script even when ops fit', () => {
    const decision = routeScript(
      {
        fitsKnownOps: true,
        escalation: {
          reason: 'user asked for a script',
          capabilities: READ_ONLY,
          userRequested: true,
        },
      },
      ENABLED,
    );
    expect(decision).toMatchObject({ runtime: SANDBOXED_SCRIPT_RUNTIME });
  });
});

describe('classifyCapabilityRisk (D1)', () => {
  it('read-only bounded scopes are low risk', () => {
    expect(classifyCapabilityRisk(READ_ONLY)).toBe('low');
  });

  it('bounded writes and web reads are medium risk', () => {
    expect(classifyCapabilityRisk({ fsWrite: ['/workspace/reports/**'] })).toBe(
      'medium',
    );
    expect(classifyCapabilityRisk({ webSearch: true })).toBe('medium');
    expect(classifyCapabilityRisk({ webRead: ['https://example.com'] })).toBe(
      'medium',
    );
  });

  it('broad scopes or real network are high risk', () => {
    expect(classifyCapabilityRisk({ fsRead: ['**'] })).toBe('high');
    expect(classifyCapabilityRisk({ fsWrite: ['/workspace'] })).toBe('high');
    expect(classifyCapabilityRisk({ network: 'mediated' })).toBe('high');
  });
});
