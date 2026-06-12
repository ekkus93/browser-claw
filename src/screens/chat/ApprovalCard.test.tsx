import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalCard } from './ApprovalCard.tsx';
import type { ApprovalRequest } from '../../store/slices/approvalsSlice.ts';

const approval: ApprovalRequest = {
  id: 'a1',
  kind: 'storage_write',
  title: 'Save memory',
  risk: 'low',
  summary: 'Persist a new memory record',
  payloadPreview: '{"text":"remember this"}',
  status: 'pending',
};

function setup() {
  const onApprove = vi.fn();
  const onReject = vi.fn();
  const onEdit = vi.fn();
  render(
    <ApprovalCard
      approval={approval}
      onApprove={onApprove}
      onReject={onReject}
      onEdit={onEdit}
    />,
  );
  return { onApprove, onReject, onEdit };
}

describe('ApprovalCard', () => {
  it('shows the action, risk, and exact payload', () => {
    setup();
    expect(screen.getByText('Save memory')).toBeInTheDocument();
    expect(screen.getByText(/risk: low/i)).toBeInTheDocument();
    expect(screen.getByText('{"text":"remember this"}')).toBeInTheDocument();
  });

  it('fires approve and reject', async () => {
    const user = userEvent.setup();
    const { onApprove, onReject } = setup();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledWith('a1');
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onReject).toHaveBeenCalledWith('a1');
  });

  it('lets the user edit the payload before approving', async () => {
    const user = userEvent.setup();
    const { onEdit } = setup();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const textarea = screen.getByRole('textbox');
    // Set the JSON directly — userEvent.type would parse the braces as keys.
    fireEvent.change(textarea, { target: { value: '{"text":"edited"}' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEdit).toHaveBeenCalledWith('a1', '{"text":"edited"}');
  });
});
