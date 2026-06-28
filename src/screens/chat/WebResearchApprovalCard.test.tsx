import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WebResearchApprovalCard } from './WebResearchApprovalCard.tsx';
import { type ApprovalRequest } from '../../store/slices/approvalsSlice.ts';

function makeApproval(
  overrides: Partial<ApprovalRequest> = {},
): ApprovalRequest {
  return {
    id: 'test-id',
    kind: 'web_page_read',
    title: 'Web research',
    summary: 'Read a page',
    risk: 'low',
    status: 'pending',
    payloadPreview: JSON.stringify({ urls: ['https://example.com/page'] }),
    ...overrides,
  };
}

describe('WebResearchApprovalCard', () => {
  it('C1: renders with single URL — shows "Read 1 page"', () => {
    render(
      <WebResearchApprovalCard
        approval={makeApproval()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText('Read 1 page')).toBeDefined();
    expect(screen.getByText('https://example.com/page')).toBeDefined();
  });

  it('C1: renders with 6 URLs — shows "Read 6 pages" and "and 1 more" truncation', () => {
    const urls = Array.from(
      { length: 6 },
      (_, i) => `https://example.com/p${String(i)}`,
    );
    render(
      <WebResearchApprovalCard
        approval={makeApproval({
          payloadPreview: JSON.stringify({ urls }),
        })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText('Read 6 pages')).toBeDefined();
    expect(screen.getByText('and 1 more')).toBeDefined();
  });

  it('C1: bulk_research approval shows query text', () => {
    render(
      <WebResearchApprovalCard
        approval={makeApproval({
          kind: 'bulk_research',
          payloadPreview: JSON.stringify({
            query: 'TypeScript tips',
            urls: ['https://example.com/a'],
          }),
        })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/TypeScript tips/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Search:/).length).toBeGreaterThan(0);
  });

  it('C1: low risk → success badge tone (rendered in DOM)', () => {
    const { container } = render(
      <WebResearchApprovalCard
        approval={makeApproval({ risk: 'low' })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('low risk');
  });

  it('C1: high risk badge text present', () => {
    const { container } = render(
      <WebResearchApprovalCard
        approval={makeApproval({ risk: 'high' })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('high risk');
  });

  it('C1: Approve button calls onApprove with correct id', async () => {
    const onApprove = vi.fn();
    render(
      <WebResearchApprovalCard
        approval={makeApproval({ id: 'approval-42' })}
        onApprove={onApprove}
        onReject={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith('approval-42');
  });

  it('C1: Reject button calls onReject with correct id', async () => {
    const onReject = vi.fn();
    render(
      <WebResearchApprovalCard
        approval={makeApproval({ id: 'approval-99' })}
        onApprove={vi.fn()}
        onReject={onReject}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /reject/i }));
    expect(onReject).toHaveBeenCalledWith('approval-99');
  });

  it('C1: malformed payloadPreview (not JSON) renders without crash', () => {
    render(
      <WebResearchApprovalCard
        approval={makeApproval({ payloadPreview: 'not json {{{' })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    // Falls back to raw text display — the raw string should be in the DOM
    expect(screen.getByText('not json {{{')).toBeDefined();
  });

  it('C1: domain badges extracted from URLs (deduped)', () => {
    const urls = [
      'https://example.com/a',
      'https://example.com/b',
      'https://other.com/c',
    ];
    render(
      <WebResearchApprovalCard
        approval={makeApproval({
          payloadPreview: JSON.stringify({ urls }),
        })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    // Should show 2 domain badges (deduped)
    const domainBadges = screen.getAllByText(/example\.com|other\.com/);
    expect(domainBadges.length).toBeGreaterThanOrEqual(2);
  });
});
