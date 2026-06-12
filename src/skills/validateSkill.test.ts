import { describe, expect, it } from 'vitest';
import { validateSkillImport } from './validateSkill.ts';
import { emptyPermissions, type ParsedSkill } from './skillTypes.ts';

function skill(over: {
  name?: string;
  version?: string;
  description?: string;
  permissions?: Record<string, unknown>;
}): ParsedSkill {
  return {
    manifest: {
      name: over.name ?? 'summarize-pdf',
      version: over.version ?? '1.2.3',
      description: over.description ?? 'Summarizes PDFs',
      permissions: {
        ...emptyPermissions(),
        ...over.permissions,
      } as ParsedSkill['manifest']['permissions'],
    },
    instructions: 'do the thing',
    files: {},
  };
}

describe('validateSkillImport', () => {
  it('accepts a complete, well-formed skill', () => {
    expect(validateSkillImport(skill({}))).toEqual({ ok: true });
  });

  it('rejects a missing name', () => {
    const result = validateSkillImport(skill({ name: '' }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(' ')).toMatch(/name/i);
  });

  it('rejects an invalid name', () => {
    const result = validateSkillImport(skill({ name: 'Not A Slug!' }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(' ')).toMatch(/name/i);
  });

  it('rejects a missing description', () => {
    const result = validateSkillImport(skill({ description: '   ' }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(' ')).toMatch(
      /description/i,
    );
  });

  it('rejects a missing or non-semver version', () => {
    expect(validateSkillImport(skill({ version: '' })).ok).toBe(false);
    expect(validateSkillImport(skill({ version: 'latest' })).ok).toBe(false);
  });

  it('rejects an unknown permission field', () => {
    const result = validateSkillImport(
      skill({ permissions: { filesystem: true } }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.join(' ')).toMatch(
      /unknown permission/i,
    );
  });
});
