import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';

const originalConsoleError = console.error.bind(console);

beforeAll(() => {
  console.error = (...args: unknown[]) => {
    const message = args.map((value) => String(value)).join(' ');
    if (message.includes('not wrapped in act')) {
      throw new Error(`React test state update escaped act(): ${message}`);
    }
    originalConsoleError(...args);
  };
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  console.error = originalConsoleError;
});
