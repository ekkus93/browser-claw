import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isPathAllowed,
  isPathSafe,
  isReservedStateKey,
  RESERVED_STATE_KEYS,
  SkillFs,
} from './skillFs.ts';
import { BrowserClawDB } from '../db/db.ts';
import type { SkillPermissions } from './skillTypes.ts';

describe('isPathAllowed', () => {
  const namespaces = ['skills/x/data/**', 'skills/x/out/**'];

  it('allows paths inside approved namespaces', () => {
    expect(isPathAllowed('skills/x/data/file.txt', namespaces)).toBe(true);
    expect(isPathAllowed('skills/x/out/result.json', namespaces)).toBe(true);
  });

  it('denies paths outside namespaces, traversal, and absolute escapes', () => {
    expect(isPathAllowed('skills/y/data/file.txt', namespaces)).toBe(false);
    expect(isPathAllowed('skills/x/data/../../etc', namespaces)).toBe(false);
    expect(isPathAllowed('', namespaces)).toBe(false);
    expect(isPathAllowed('skills/x/data/file', [])).toBe(false);
  });
});

describe('isPathSafe — strict traversal/escape rejection', () => {
  it('accepts a clean relative path', () => {
    expect(isPathSafe('skills/x/data/file.txt')).toBe(true);
  });

  it('rejects every escape technique', () => {
    expect(isPathSafe('')).toBe(false);
    expect(isPathSafe('../secrets')).toBe(false); // parent traversal
    expect(isPathSafe('a/./b')).toBe(false); // dot segment
    expect(isPathSafe('/etc/passwd')).toBe(false); // absolute
    expect(isPathSafe('a\\..\\b')).toBe(false); // backslash traversal
    expect(isPathSafe('a/\0/b')).toBe(false); // null byte
    expect(isPathSafe('skills/x/%2e%2e/secret')).toBe(false); // encoded ..
    expect(isPathSafe('skills/x/%2e%2e%2fsecret')).toBe(false); // encoded ../
    expect(isPathSafe('a/%00/b')).toBe(false); // encoded null byte
    expect(isPathSafe('a/%ZZ/b')).toBe(false); // malformed encoding
  });
});

describe('isReservedStateKey', () => {
  it('treats the whole __…__ namespace as reserved', () => {
    for (const key of RESERVED_STATE_KEYS) {
      expect(isReservedStateKey(key)).toBe(true);
    }
    expect(isReservedStateKey('__anything')).toBe(true);
    expect(isReservedStateKey('count')).toBe(false);
    expect(isReservedStateKey('user_pref')).toBe(false);
  });
});

describe('SkillFs — runtime enforcement', () => {
  const db = new BrowserClawDB();
  const permissions: SkillPermissions = {
    tools: [],
    read: ['skills/s/data/**'],
    write: ['skills/s/out/**'],
    network: false,
  };

  afterEach(async () => {
    await db.skill_state.clear();
    await db.skill_files.clear();
  });

  it('rejects traversal on read and write', async () => {
    const fs = new SkillFs(db, 's', permissions);
    await expect(fs.readText('skills/s/data/../../etc')).rejects.toThrow(
      /denied/,
    );
    await expect(
      fs.writeText('skills/s/out/%2e%2e/escape', 'x'),
    ).rejects.toThrow(/denied/);
  });

  it('allows reads/writes inside the namespace and round-trips state', async () => {
    const fs = new SkillFs(db, 's', permissions);
    await fs.writeText('skills/s/out/note.txt', 'hi');
    await fs.setState('count', 7);
    expect(await fs.getState('count')).toBe(7);
  });

  it('forbids a skill from reading or writing reserved state keys', async () => {
    const fs = new SkillFs(db, 's', permissions);
    // The host stores permissions under a reserved key; the skill must not be
    // able to overwrite it to escalate, nor read other system rows.
    await db.skill_state.put({
      skillId: 's',
      key: '__permissions__',
      value: permissions,
    });
    await expect(fs.setState('__permissions__', {})).rejects.toThrow(
      /reserved/,
    );
    await expect(fs.getState('__secrets__')).rejects.toThrow(/reserved/);

    // The permissions row is untouched after the rejected write.
    const row = await db.skill_state.get(['s', '__permissions__']);
    expect(row?.value).toEqual(permissions);
  });
});
