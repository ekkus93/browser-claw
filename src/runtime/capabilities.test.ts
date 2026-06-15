import { describe, expect, it } from 'vitest';
import {
  aggregateRisk,
  classifyCapabilityRisk,
  isKnownCapabilityName,
  skillToolName,
  validateCapability,
  type Capability,
} from './capabilities.ts';

describe('capability names (F1)', () => {
  it('recognizes the fixed capability vocabulary', () => {
    for (const name of [
      'workspace.read',
      'workspace.write',
      'workspace.delete',
      'workspace.search',
      'web.search',
      'web.readPage',
      'web.readCurrentTab',
      'script.plan',
      'script.sandbox',
    ]) {
      expect(isKnownCapabilityName(name)).toBe(true);
    }
  });

  it('recognizes skill.tool.<name> and rejects the bare prefix', () => {
    expect(isKnownCapabilityName('skill.tool.Page Reader')).toBe(true);
    expect(skillToolName('skill.tool.Page Reader')).toBe('Page Reader');
    expect(isKnownCapabilityName('skill.tool.')).toBe(false);
    expect(skillToolName('web.search')).toBeNull();
  });

  it('rejects unknown names', () => {
    expect(isKnownCapabilityName('workspace.format')).toBe(false);
    expect(isKnownCapabilityName('secrets.read')).toBe(false);
  });
});

describe('validateCapability (F1)', () => {
  it('accepts a capability with a valid scope', () => {
    const result = validateCapability({
      name: 'workspace.write',
      scope: { paths: ['/workspace/reports/**'], limits: { maxFiles: 5 } },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown name', () => {
    expect(validateCapability({ name: 'nope' }).ok).toBe(false);
  });

  it('rejects an unsafe path scope', () => {
    const result = validateCapability({
      name: 'workspace.read',
      scope: { paths: ['/etc/passwd'] },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a disallowed url scope', () => {
    const result = validateCapability({
      name: 'web.readPage',
      scope: { urls: ['http://localhost/admin'] },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a negative limit', () => {
    const result = validateCapability({
      name: 'web.search',
      scope: { limits: { maxResults: -1 } },
    });
    expect(result.ok).toBe(false);
  });
});

describe('classifyCapabilityRisk (F1)', () => {
  const cap = (name: string, scope?: Capability['scope']): Capability =>
    ({ name, ...(scope ? { scope } : {}) }) as Capability;

  it('reads/searches are low risk', () => {
    expect(classifyCapabilityRisk(cap('workspace.read'))).toBe('low');
    expect(classifyCapabilityRisk(cap('workspace.search'))).toBe('low');
  });

  it('delete and sandbox scripting are high risk', () => {
    expect(classifyCapabilityRisk(cap('workspace.delete'))).toBe('high');
    expect(classifyCapabilityRisk(cap('script.sandbox'))).toBe('high');
  });

  it('bounded writes are medium, broad writes are high', () => {
    expect(
      classifyCapabilityRisk(
        cap('workspace.write', { paths: ['/workspace/out/**'] }),
      ),
    ).toBe('medium');
    expect(
      classifyCapabilityRisk(
        cap('workspace.write', { paths: ['/workspace/**'] }),
      ),
    ).toBe('high');
  });

  it('web, plan, and skill tools are medium', () => {
    expect(classifyCapabilityRisk(cap('web.readPage'))).toBe('medium');
    expect(classifyCapabilityRisk(cap('script.plan'))).toBe('medium');
    expect(classifyCapabilityRisk(cap('skill.tool.Remember'))).toBe('medium');
  });

  it('aggregateRisk takes the maximum', () => {
    expect(aggregateRisk([cap('workspace.read'), cap('web.search')])).toBe(
      'medium',
    );
    expect(
      aggregateRisk([cap('workspace.read'), cap('workspace.delete')]),
    ).toBe('high');
    expect(aggregateRisk([])).toBe('low');
  });
});
