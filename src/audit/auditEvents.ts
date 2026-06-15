/**
 * Typed audit-event builders for the new domains (Part F4): workspace files, the
 * script runtime, web research, and the browser extension. Each builder fixes
 * the correct {@link AuditSource} so callers can't mis-source an event, and
 * returns an {@link AppendAuditInput} that {@link buildAuditRow} then sanitizes
 * (credential redaction + length cap). Builders never embed secrets; pass
 * correlation ids and bounded previews, not payloads.
 */

import type { AppendAuditInput } from './auditService.ts';
import type { AuditRiskLevel, AuditStatus } from '../db/types.ts';

export interface DomainAuditOptions {
  risk?: AuditRiskLevel;
  status?: AuditStatus;
  at?: number;
}

function build(
  source: AppendAuditInput['source'],
  type: string,
  summary: string,
  options: DomainAuditOptions = {},
): AppendAuditInput {
  return {
    type,
    summary,
    source,
    ...(options.risk !== undefined ? { risk: options.risk } : {}),
    ...(options.status !== undefined ? { status: options.status } : {}),
    ...(options.at !== undefined ? { at: options.at } : {}),
  };
}

/** A `workspace`-sourced audit event (file create/update/delete/move/copy). */
export function workspaceAuditEvent(
  type: string,
  summary: string,
  options?: DomainAuditOptions,
): AppendAuditInput {
  return build('workspace', type, summary, options);
}

/** A `script`-sourced audit event (plan / sandbox lifecycle + capability use). */
export function scriptAuditEvent(
  type: string,
  summary: string,
  options?: DomainAuditOptions,
): AppendAuditInput {
  return build('script', type, summary, options);
}

/** A `web`-sourced audit event (search / page read). */
export function webAuditEvent(
  type: string,
  summary: string,
  options?: DomainAuditOptions,
): AppendAuditInput {
  return build('web', type, summary, options);
}

/** An `extension`-sourced audit event (connected / permission / page read). */
export function extensionAuditEvent(
  type: string,
  summary: string,
  options?: DomainAuditOptions,
): AppendAuditInput {
  return build('extension', type, summary, options);
}
