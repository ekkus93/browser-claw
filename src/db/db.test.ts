import { describe, expect, it } from 'vitest';
import { db } from './db.ts';

describe('db', () => {
  it('is configured with the browserclaw database name', () => {
    expect(db.name).toBe('browserclaw');
  });
});
