import type { ParsedSkill } from './skillTypes.ts';

/**
 * Strict skill-import validation (hardening TODO 7.1). A skill is rejected
 * unless it declares a valid name, version, and description and requests only
 * known permission fields. Parsing is lenient; THIS is the gate — install()
 * runs it so a malformed or over-broad skill can never be persisted, even if a
 * UI path forgets to check.
 */

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+([-.][0-9A-Za-z-]+)*$/;
const ALLOWED_PERMISSION_KEYS = ['tools', 'read', 'write', 'network'];

export type SkillValidation = { ok: true } | { ok: false; errors: string[] };

export function validateSkillImport(parsed: ParsedSkill): SkillValidation {
  const errors: string[] = [];
  const manifest = parsed.manifest;

  if (!manifest.name) {
    errors.push('Skill name is required.');
  } else if (!NAME_PATTERN.test(manifest.name)) {
    errors.push(
      'Skill name must be a lowercase slug (a-z, 0-9, and -._), up to 64 chars.',
    );
  }

  if (!manifest.version) {
    errors.push('Skill version is required.');
  } else if (!VERSION_PATTERN.test(manifest.version)) {
    errors.push('Skill version must be a semantic version like 1.2.3.');
  }

  if (!manifest.description || manifest.description.trim().length === 0) {
    errors.push('Skill description is required.');
  }

  // Permissions are typed, but a .clawskill spreads arbitrary JSON in — reject
  // any permission key we don't explicitly understand rather than ignoring it.
  const permissions = (manifest.permissions ?? {}) as unknown as Record<
    string,
    unknown
  >;
  for (const key of Object.keys(permissions)) {
    if (!ALLOWED_PERMISSION_KEYS.includes(key)) {
      errors.push(`Unknown permission field: ${key}.`);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
