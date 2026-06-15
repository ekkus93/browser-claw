import { describe, expect, it } from 'vitest';
import { buildAuditRow } from './auditService.ts';
import {
  extensionAuditEvent,
  scriptAuditEvent,
  webAuditEvent,
  workspaceAuditEvent,
} from './auditEvents.ts';

describe('domain audit-event builders (F4)', () => {
  it('fixes the correct source per domain', () => {
    expect(workspaceAuditEvent('workspace.file_created', 's').source).toBe(
      'workspace',
    );
    expect(scriptAuditEvent('script.sandbox_started', 's').source).toBe(
      'script',
    );
    expect(webAuditEvent('web.page_read', 's').source).toBe('web');
    expect(extensionAuditEvent('extension.connected', 's').source).toBe(
      'extension',
    );
  });

  it('carries risk/status options through', () => {
    const event = workspaceAuditEvent('workspace.file_deleted', 'del', {
      risk: 'medium',
      status: 'success',
    });
    expect(event).toMatchObject({ risk: 'medium', status: 'success' });
  });

  it('produces input that buildAuditRow sanitizes (redaction applies)', () => {
    const row = buildAuditRow(
      webAuditEvent(
        'web.page_read',
        'fetched with Authorization: Bearer sk-abcdefghijklmnop1234',
      ),
    );
    expect(row.source).toBe('web');
    expect(row.summary).not.toContain('sk-abcdefghijklmnop1234');
  });
});
