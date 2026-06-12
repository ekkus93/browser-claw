import { describe, expect, it } from 'vitest';
import { parseSkillMd, parseClawskill } from './parseSkill.ts';

describe('parseSkillMd', () => {
  it('parses frontmatter into a manifest and keeps the body', () => {
    const text = [
      '---',
      'name: summarize-pdf',
      'version: 1.2.0',
      'description: Summarizes PDFs',
      'tools: [Page Reader, File Reader]',
      'read: skills/summarize-pdf/data/**',
      'network: false',
      '---',
      'Read the PDF and summarize it.',
    ].join('\n');

    const parsed = parseSkillMd(text);
    expect(parsed.manifest.name).toBe('summarize-pdf');
    expect(parsed.manifest.version).toBe('1.2.0');
    expect(parsed.manifest.permissions.tools).toEqual([
      'Page Reader',
      'File Reader',
    ]);
    expect(parsed.manifest.permissions.read).toEqual([
      'skills/summarize-pdf/data/**',
    ]);
    expect(parsed.manifest.permissions.network).toBe(false);
    expect(parsed.instructions).toBe('Read the PDF and summarize it.');
  });

  it('falls back to defaults without frontmatter', () => {
    const parsed = parseSkillMd('just instructions');
    expect(parsed.manifest.name).toBe('untitled-skill');
    expect(parsed.instructions).toBe('just instructions');
  });
});

describe('parseClawskill', () => {
  it('parses a JSON package', () => {
    const parsed = parseClawskill(
      JSON.stringify({
        manifest: { name: 'web-search', permissions: { network: true } },
        instructions: 'search',
        files: { 'SKILL.md': 'x' },
      }),
    );
    expect(parsed.manifest.name).toBe('web-search');
    expect(parsed.manifest.permissions.network).toBe(true);
    expect(parsed.files['SKILL.md']).toBe('x');
  });

  it('rejects a package without a manifest name', () => {
    expect(() => parseClawskill('{}')).toThrow(/manifest.name/);
  });
});
