/**
 * Host handler for the runtime's `extension_request` effect (Part F3). Most
 * extension messages (ping/status) pass straight through to the companion
 * extension. A `request_host_permission` is different: granting the extension
 * access to a new origin is a meaningful capability escalation, so it is queued
 * for inline approval (kind `extension_permission`); only on approval is the
 * permission request sent to the extension and the effect resolved with its
 * response. The actual `chrome.permissions.request` happens inside the extension
 * service worker (real browser); this bridge gates and mediates it.
 */

import { approvalRequested } from '../store/slices/approvalsSlice.ts';
import { recordAudit } from '../audit/auditSink.ts';
import { extensionAuditEvent } from '../audit/auditEvents.ts';
import {
  isExtensionResponse,
  parseExtensionRequest,
  type ExtensionRequest,
} from '../extension/protocol.ts';
import type { ExtensionTransport } from '../extension/pageReaderProvider.ts';
import type { AppDispatch } from '../store/store.ts';
import type { BrowserClawDB } from '../db/db.ts';
import type { Command, Effect } from './effectTypes.ts';

type ExtensionEffect = Extract<Effect, { type: 'extension_request' }>;

export interface ExtensionEffectDeps {
  transport: ExtensionTransport;
  db: BrowserClawDB;
  dispatch: AppDispatch;
  submit: (command: Command) => Promise<void>;
}

/** Send a validated request to the extension and resolve the effect with it. */
async function sendAndResolve(
  deps: ExtensionEffectDeps,
  id: string,
  request: ExtensionRequest,
): Promise<void> {
  try {
    const response = await deps.transport.send(request);
    if (!isExtensionResponse(response)) {
      await deps.submit({
        type: 'resolve_effect',
        id,
        result: {
          ok: false,
          error: { kind: 'extension_protocol_error', message: 'bad response' },
        },
      });
      return;
    }
    await deps.submit({ type: 'resolve_effect', id, result: response });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.submit({
      type: 'resolve_effect',
      id,
      result: { ok: false, error: { kind: 'extension_missing', message } },
    });
  }
}

export function createExtensionEffectHandler(deps: ExtensionEffectDeps) {
  return async (effect: ExtensionEffect): Promise<void> => {
    const parsed = parseExtensionRequest(effect.request);
    if (!parsed.ok) {
      await deps.submit({
        type: 'resolve_effect',
        id: effect.id,
        result: {
          ok: false,
          error: { kind: 'extension_invalid', message: parsed.reason },
        },
      });
      return;
    }

    // A host-permission request escalates the extension's reach — gate it.
    if (parsed.request.type === 'request_host_permission') {
      const { origin } = parsed.request;
      deps.dispatch(
        approvalRequested({
          id: effect.id,
          kind: 'extension_permission',
          title: `Grant extension access to ${origin}`,
          risk: 'high',
          summary: `Request host permission for ${origin}`,
          payloadPreview: JSON.stringify(parsed.request),
        }),
      );
      return;
    }

    // Other requests are benign and pass through directly.
    await sendAndResolve(deps, effect.id, parsed.request);
  };
}

export interface ApprovedExtensionPermission {
  id: string;
  status: 'approved' | 'rejected';
  /** The request_host_permission JSON the user reviewed (payloadPreview). */
  payloadPreview?: string;
}

/**
 * Send (or decline) a host-permission request the user resolved on the approval
 * card, then resolve the runtime effect. Called by the resolution listener.
 */
export async function runApprovedExtensionPermission(
  deps: ExtensionEffectDeps,
  approval: ApprovedExtensionPermission,
): Promise<void> {
  const parsed = approval.payloadPreview
    ? parseExtensionRequest(safeParse(approval.payloadPreview))
    : { ok: false as const, reason: 'no payload' };

  if (approval.status !== 'approved') {
    const origin =
      parsed.ok && parsed.request.type === 'request_host_permission'
        ? parsed.request.origin
        : 'unknown';
    void recordAudit(
      deps.db,
      deps.dispatch,
      extensionAuditEvent(
        'extension.permission_rejected',
        `Extension host permission rejected: ${origin}`,
        { status: 'rejected' },
      ),
    );
    await deps.submit({
      type: 'resolve_effect',
      id: approval.id,
      result: { ok: false, error: { kind: 'user_rejected' } },
    });
    return;
  }

  if (!parsed.ok || parsed.request.type !== 'request_host_permission') {
    await deps.submit({
      type: 'resolve_effect',
      id: approval.id,
      result: {
        ok: false,
        error: {
          kind: 'extension_invalid',
          message: 'invalid permission request',
        },
      },
    });
    return;
  }

  void recordAudit(
    deps.db,
    deps.dispatch,
    extensionAuditEvent(
      'extension.permission_requested',
      `Requesting extension host permission: ${parsed.request.origin}`,
      { risk: 'high', status: 'pending' },
    ),
  );
  await sendAndResolve(deps, approval.id, parsed.request);
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
