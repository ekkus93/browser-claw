import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import WorkflowScreen from './WorkflowScreen.tsx';

describe('WorkflowScreen', () => {
  it('renders the workflow steps and the journey', () => {
    render(<WorkflowScreen />);
    expect(
      screen.getByRole('heading', { name: 'User Workflow' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'First-run setup' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'You approve' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Typical user journey' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Export backups')).toBeInTheDocument();
  });
});
