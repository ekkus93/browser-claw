import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db.ts';
import { appendAuditEvent } from '../audit/auditService.ts';
import AuditScreen from './AuditScreen.tsx';

beforeEach(async () => {
  await db.open();
  await db.audit_events.clear();
});

async function seed() {
  await appendAuditEvent(db, {
    type: 'llm_request_sent',
    summary: 'LLM request sent',
    source: 'runtime',
    risk: 'low',
    at: 5,
  });
  await appendAuditEvent(db, {
    type: 'memory_created',
    summary: 'Memory created',
    source: 'storage',
    risk: 'info',
    at: 4,
  });
}

describe('AuditScreen', () => {
  it('lists durable audit events', async () => {
    await seed();
    render(<AuditScreen />);
    expect(await screen.findByText('LLM request sent')).toBeInTheDocument();
    expect(screen.getByText('Memory created')).toBeInTheDocument();
  });

  it('shows an empty state when there are no events', async () => {
    render(<AuditScreen />);
    expect(await screen.findByText('No audit events.')).toBeInTheDocument();
  });

  it('expands a row to show its JSON detail', async () => {
    const user = userEvent.setup();
    await seed();
    render(<AuditScreen />);
    await user.click(await screen.findByText('Memory created'));
    expect(screen.getByText('Details JSON')).toBeInTheDocument();
    expect(screen.getByText(/"type": "memory_created"/)).toBeInTheDocument();
  });

  it('clears the durable audit log', async () => {
    const user = userEvent.setup();
    await seed();
    render(<AuditScreen />);
    await screen.findByText('LLM request sent');
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() =>
      expect(screen.getByText('No audit events.')).toBeInTheDocument(),
    );
    expect(await db.audit_events.count()).toBe(0);
  });
});
