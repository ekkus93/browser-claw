import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';
import chatReducer from '../store/slices/chatSlice.ts';
import approvalsReducer, {
  approvalRequested,
} from '../store/slices/approvalsSlice.ts';
import ChatScreen from './ChatScreen.tsx';

// The db singleton stays open for the file; useLiveQuery subscriptions are torn
// down by Testing Library's afterEach cleanup. (Closing it here would race the
// live query and throw DatabaseClosedError.)

function renderChat() {
  const store = configureStore({
    reducer: { chat: chatReducer, approvals: approvalsReducer },
  });
  render(
    <Provider store={store}>
      <ChatScreen />
    </Provider>,
  );
  return store;
}

describe('ChatScreen', () => {
  it('shows the empty state, then the message after sending', async () => {
    const user = userEvent.setup();
    renderChat();
    expect(screen.getByText('Start a conversation')).toBeInTheDocument();

    await user.type(
      screen.getByRole('textbox', { name: 'Message' }),
      'hello world',
    );
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() =>
      expect(screen.getByText('hello world')).toBeInTheDocument(),
    );
  });

  it('renders a pending approval and resolves it off the queue', async () => {
    const user = userEvent.setup();
    const store = renderChat();
    store.dispatch(
      approvalRequested({
        id: 'a1',
        kind: 'tool_call',
        title: 'Write file',
        risk: 'high',
        summary: 'writes a file',
        payloadPreview: '{"path":"/x"}',
      }),
    );

    expect(await screen.findByText('Write file')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(store.getState().approvals.queue).toHaveLength(0),
    );
  });
});
