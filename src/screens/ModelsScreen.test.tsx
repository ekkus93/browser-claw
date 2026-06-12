import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';
import providersReducer from '../store/slices/providersSlice.ts';
import modelsReducer from '../store/slices/modelsSlice.ts';
import { ToastProvider } from '../components/ui/Toast.tsx';
import ModelsScreen from './ModelsScreen.tsx';

function renderModels() {
  const store = configureStore({
    reducer: { providers: providersReducer, models: modelsReducer },
  });
  render(
    <Provider store={store}>
      <ToastProvider>
        <ModelsScreen />
      </ToastProvider>
    </Provider>,
  );
  return store;
}

describe('ModelsScreen', () => {
  it('lists the providers and browser-local models', () => {
    renderModels();
    expect(
      screen.getByRole('heading', { name: 'Remote Providers' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'OpenAI' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ollama' })).toBeInTheDocument();
    expect(
      screen.getByText('SmolLM2-1.7B Instruct (Q4_K_M)'),
    ).toBeInTheDocument();
    expect(screen.getByText('No downloads in progress.')).toBeInTheDocument();
  });

  it('updates provider health when tested', async () => {
    const user = userEvent.setup();
    const store = renderModels();

    // The first Test button belongs to the OpenAI card.
    const testButtons = screen.getAllByRole('button', { name: 'Test' });
    await user.click(testButtons[0]!);

    expect(store.getState().providers.health.openai).toBe('connected');
    expect(store.getState().providers.activeProviderId).toBe('openai');
  });
});
