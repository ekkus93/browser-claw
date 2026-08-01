import 'fake-indexeddb/auto';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';
import chatReducer, { chatErrored } from '../store/slices/chatSlice.ts';
import approvalsReducer, {
  approvalRequested,
} from '../store/slices/approvalsSlice.ts';
import providersReducer, {
  activeProviderSet,
} from '../store/slices/providersSlice.ts';
import ChatScreen from './ChatScreen.tsx';

// The db singleton stays open for the file; useLiveQuery subscriptions are torn
// down by Testing Library's afterEach cleanup. (Closing it here would race the
// live query and throw DatabaseClosedError.)

function renderChat({ providerId }: { providerId?: string } = {}) {
  const store = configureStore({
    reducer: {
      chat: chatReducer,
      approvals: approvalsReducer,
      providers: providersReducer,
    },
  });
  if (providerId) {
    store.dispatch(activeProviderSet({ id: providerId, label: providerId }));
  }
  render(
    <Provider store={store}>
      <MemoryRouter>
        <ChatScreen />
      </MemoryRouter>
    </Provider>,
  );
  return store;
}

describe('ChatScreen', () => {
  it('blocks chat with a setup CTA when no provider is configured', () => {
    renderChat();
    expect(screen.getByText('No provider configured')).toBeInTheDocument();
    expect(screen.getByTestId('chat-setup-cta')).toHaveAttribute(
      'href',
      '/models',
    );
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  it('shows the empty state, then the message after sending', async () => {
    const user = userEvent.setup();
    renderChat({ providerId: 'openai' });
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

  it('shows a provider error card, not a fake assistant reply', async () => {
    const store = renderChat({ providerId: 'openai' });
    act(() => {
      store.dispatch(
        chatErrored({
          kind: 'cors',
          message: 'Blocked by the browser (CORS).',
        }),
      );
    });

    expect(await screen.findByTestId('chat-error')).toBeInTheDocument();
    expect(
      screen.getByText('The provider could not respond'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Blocked by the browser (CORS).'),
    ).toBeInTheDocument();
    // The failure never appears as a normal assistant message bubble.
    expect(screen.queryByText('assistant')).not.toBeInTheDocument();
  });

  it('renders a pending approval and resolves it off the queue', async () => {
    const user = userEvent.setup();
    const store = renderChat({ providerId: 'openai' });
    act(() => {
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
    });

    expect(await screen.findByText('Write file')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(store.getState().approvals.queue).toHaveLength(0),
    );
  });
});
