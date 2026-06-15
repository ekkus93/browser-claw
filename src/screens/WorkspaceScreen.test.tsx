import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import WorkspaceScreen from './WorkspaceScreen.tsx';

// jsdom has no OPFS, so isOpfsAvailable() is false: the content-search UI is
// present but disabled, and the unavailable-storage banner shows (Part G1).

describe('WorkspaceScreen (G1)', () => {
  it('renders the workspace with the search/grep UI', () => {
    render(<WorkspaceScreen />);
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('text to grep…')).toBeInTheDocument();
  });

  it('disables content search when OPFS storage is unavailable', () => {
    render(<WorkspaceScreen />);
    expect(screen.getByPlaceholderText('text to grep…')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/OPFS/);
  });

  it('disables the unimplemented file actions', () => {
    render(<WorkspaceScreen />);
    expect(screen.getByRole('button', { name: 'New file' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();
  });
});
