import { describe, expect, it } from 'vitest';
import { isAllowedSenderUrl } from './protocol.ts';

const allowed = [
  'https://ekkus93.github.io/browser-claw',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
] as const;

describe('BrowserClaw extension sender isolation', () => {
  it.each([
    'https://ekkus93.github.io/browser-claw/',
    'https://ekkus93.github.io/browser-claw/chat',
    'http://localhost:5173/settings',
    'http://127.0.0.1:5173/workspace',
  ])('accepts an explicitly allowed application URL: %s', (url) => {
    expect(isAllowedSenderUrl(url, allowed)).toBe(true);
  });

  it.each([
    undefined,
    '',
    'not a url',
    'http://ekkus93.github.io/browser-claw/chat',
    'https://ekkus93.github.io:444/browser-claw/chat',
    'https://browser-claw.ekkus93.github.io/chat',
    'https://ekkus93.github.io.evil.example/browser-claw/chat',
    'https://ekkus93.github.io/browser-claw-lookalike/chat',
    'https://ekkus93.github.io/other/browser-claw/chat',
    'http://localhost:4173/chat',
    'https://127.0.0.1:5173/chat',
  ])('rejects a non-matching or malformed sender URL: %s', (url) => {
    expect(isAllowedSenderUrl(url, allowed)).toBe(false);
  });

  it('fails closed when an allowed URL entry is malformed', () => {
    expect(
      isAllowedSenderUrl('https://ekkus93.github.io/browser-claw/chat', [
        'not a url',
      ]),
    ).toBe(false);
  });
});
