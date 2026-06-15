import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ApprovalRequest } from '../../store/slices/approvalsSlice.ts';
import { ScriptApprovalCard } from './ScriptApprovalCard.tsx';

const PLAN = {
  type: 'browserclaw_plan',
  version: 1,
  title: 'Tidy docs',
  reason: 'normalize headings',
  steps: [
    { id: 'r', op: 'fs.readText', path: '/workspace/a.md' },
    { id: 'w', op: 'fs.writeText', path: '/workspace/b.md', content: 'x' },
  ],
};

const SCRIPT = {
  type: 'browserclaw_script_request',
  version: 1,
  runtime: 'sandboxed_script',
  title: 'Aggregate',
  reason: 'custom aggregation across files',
  capabilities: {
    fsRead: ['/workspace/docs/**'],
    fsWrite: ['/workspace/reports/**'],
    secrets: 'deny',
  },
  limits: {
    timeoutMs: 5000,
    maxOutputBytes: 262144,
    maxFileReads: 100,
    maxFileWrites: 10,
  },
  code: 'return 42;',
};

function approval(over: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    id: 'a1',
    kind: 'plan',
    title: 'Tidy docs',
    risk: 'medium',
    summary: 'a plan',
    payloadPreview: JSON.stringify(PLAN),
    status: 'pending',
    ...over,
  };
}

describe('ScriptApprovalCard (G2)', () => {
  it('shows the Plan DSL runtime, steps, and files for a plan', () => {
    render(
      <ScriptApprovalCard
        approval={approval({})}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText('Structured Plan DSL v0.1')).toBeInTheDocument();
    expect(screen.getByText('fs.readText')).toBeInTheDocument();
    expect(screen.getByText(/write \/workspace\/b\.md/)).toBeInTheDocument();
    expect(screen.getByText('Risk: medium')).toBeInTheDocument();
  });

  it('shows the sandbox runtime, code, capabilities, and limits', () => {
    render(
      <ScriptApprovalCard
        approval={approval({
          id: 's1',
          kind: 'sandbox_script',
          risk: 'high',
          payloadPreview: JSON.stringify(SCRIPT),
        })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Sandboxed Script Runtime v0.2'),
    ).toBeInTheDocument();
    expect(screen.getByText('return 42;')).toBeInTheDocument();
    expect(screen.getByText('workspace.read')).toBeInTheDocument();
    expect(screen.getByText(/5000ms/)).toBeInTheDocument();
  });

  it('fires approve and reject', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(
      <ScriptApprovalCard
        approval={approval({})}
        onApprove={onApprove}
        onReject={onReject}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledWith('a1');
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onReject).toHaveBeenCalledWith('a1');
  });

  it('hides the action buttons once resolved and shows status', () => {
    render(
      <ScriptApprovalCard
        approval={approval({ status: 'approved' })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'Approve' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('approved')).toBeInTheDocument();
  });

  it('renders a failed run outcome visibly', () => {
    render(
      <ScriptApprovalCard
        approval={approval({ status: 'approved' })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        outcome={{ state: 'failed', message: 'script timed out' }}
      />,
    );
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('script timed out')).toBeInTheDocument();
  });

  it('falls back to raw payload for an unparseable plan', () => {
    render(
      <ScriptApprovalCard
        approval={approval({ payloadPreview: 'not json' })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText('Exact data')).toBeInTheDocument();
  });
});
