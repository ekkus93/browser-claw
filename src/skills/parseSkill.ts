import {
  emptyPermissions,
  type ParsedSkill,
  type SkillManifest,
} from './skillTypes.ts';

/**
 * Parse a SKILL.md (YAML-ish frontmatter + markdown body) or a .clawskill
 * (JSON package) into a normalized ParsedSkill.
 */

type FieldValue = string | string[] | boolean;

function parseValue(raw: string): FieldValue {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return raw
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return raw.replace(/^["']|["']$/g, '');
}

function parseFrontmatter(text: string): {
  fields: Record<string, FieldValue>;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { fields: {}, body: text.trim() };
  const fields: Record<string, FieldValue> = {};
  for (const line of (match[1] ?? '').split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (key.length === 0) continue;
    fields[key] = parseValue(line.slice(idx + 1).trim());
  }
  return { fields, body: (match[2] ?? '').trim() };
}

function asString(value: FieldValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: FieldValue | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.length > 0) return [value];
  return [];
}

export function parseSkillMd(text: string): ParsedSkill {
  const { fields, body } = parseFrontmatter(text);
  // Parsing does NOT invent values for missing fields — an absent name/version
  // stays empty so strict validation (validateSkillImport) can reject it rather
  // than silently installing a nameless, unversioned skill.
  const manifest: SkillManifest = {
    name: asString(fields.name),
    version: asString(fields.version),
    description: asString(fields.description),
    permissions: {
      tools: asStringArray(fields.tools),
      read: asStringArray(fields.read),
      write: asStringArray(fields.write),
      network: fields.network === true,
    },
  };
  return { manifest, instructions: body, files: { 'SKILL.md': text } };
}

export function parseClawskill(text: string): ParsedSkill {
  const data = JSON.parse(text) as Partial<ParsedSkill>;
  if (!data.manifest || typeof data.manifest.name !== 'string') {
    throw new Error('Invalid .clawskill: missing manifest.name');
  }
  return {
    manifest: {
      name: data.manifest.name,
      version: data.manifest.version ?? '',
      description: data.manifest.description ?? '',
      permissions: { ...emptyPermissions(), ...data.manifest.permissions },
    },
    instructions: data.instructions ?? '',
    files: data.files ?? {},
  };
}
