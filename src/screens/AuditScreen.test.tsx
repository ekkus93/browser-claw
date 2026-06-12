import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';
import auditReducer from '../store/slices/auditSlice.ts';
import AuditScreen from './AuditScreen.tsx';

function renderAudit() {
  const store = configureStore({ reducer: { audit: auditReducer } });
  render(
    <Provider store={store}>
      <AuditScreen />
    </Provider>,
  );
  return store;
}

describe('AuditScreen', () => {
  it('seeds and lists audit events', () => {
    renderAudit();
    expect(screen.getByText('LLM request sent')).toBeInTheDocument();
    expect(screen.getByText('Skill installed')).toBeInTheDocument();
  });

  it('expands a row to show its JSON detail', async () => {
    const user = userEvent.setup();
    renderAudit();
    await user.click(screen.getByText('Memory created'));
    expect(screen.getByText('Details JSON')).toBeInTheDocument();
    expect(screen.getByText(/"type": "memory_created"/)).toBeInTheDocument();
  });

  it('clears the audit feed', async () => {
    const user = userEvent.setup();
    const store = renderAudit();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(store.getState().audit.recent).toHaveLength(0);
    expect(screen.getByText('No audit events.')).toBeInTheDocument();
  });
});
