import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import providersReducer from '../store/slices/providersSlice.ts';
import modelsReducer from '../store/slices/modelsSlice.ts';
import { ToastProvider } from '../components/ui/Toast.tsx';
import { db } from '../db/db.ts';
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

afterEach(async () => {
  vi.unstubAllGlobals();
  await db.provider_profiles.clear();
  await db.app_settings.clear();
});

describe('ModelsScreen', () => {
  it('lists the providers and browser-local models', async () => {
    renderModels();
    expect(
      screen.getByRole('heading', { name: 'Remote Providers' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'OpenAI' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ollama' })).toBeInTheDocument();
    expect(
      screen.getByText('SmolLM2-1.7B Instruct (Q4_K_M)'),
    ).toBeInTheDocument();
    expect(screen.getByText('No downloads in progress.')).toBeInTheDocument();
  });

  it('runs a real health check when tested (no API key needed)', async () => {
    // Stub the network so the check is deterministic and offline. OpenAI's API
    // is cross-origin to the browser, so a thrown fetch maps to a likely CORS
    // block — the honest, actionable result for a browser-direct call.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('network down'))),
    );
    const user = userEvent.setup();
    const store = renderModels();

    // The first Test button belongs to the OpenAI card.
    await screen.findByRole('heading', { name: 'OpenAI' });
    const testButtons = screen.getAllByRole('button', { name: 'Test' });
    await user.click(testButtons[0]!);

    await waitFor(() =>
      expect(store.getState().providers.health.openai).toBe('cors_error'),
    );
  });

  it('persists an edited base URL to IndexedDB', async () => {
    const user = userEvent.setup();
    renderModels();
    await screen.findByRole('heading', { name: 'OpenAI' });

    const baseUrl = screen.getAllByLabelText('Base URL')[0]!;
    await user.clear(baseUrl);
    await user.type(baseUrl, 'https://proxy.test/v1');
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]!);

    await waitFor(async () => {
      const row = await db.provider_profiles.get('openai');
      expect(row?.baseUrl).toBe('https://proxy.test/v1');
    });
  });

  it('persists an edited model to IndexedDB', async () => {
    const user = userEvent.setup();
    renderModels();
    await screen.findByRole('heading', { name: 'OpenAI' });

    const modelField = screen.getAllByLabelText('Model')[0]!;
    await user.clear(modelField);
    await user.type(modelField, 'gpt-4.1-mini');
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]!);

    await waitFor(async () => {
      const row = await db.provider_profiles.get('openai');
      expect(row?.model).toBe('gpt-4.1-mini');
    });
  });

  it('tests the provider using the edited (not default) values', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchImpl);
    const user = userEvent.setup();
    renderModels();
    await screen.findByRole('heading', { name: 'OpenAI' });

    const baseUrl = screen.getAllByLabelText('Base URL')[0]!;
    await user.clear(baseUrl);
    await user.type(baseUrl, 'https://edited.example/v1');
    await user.click(screen.getAllByRole('button', { name: 'Test' })[0]!);

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://edited.example/v1/chat/completions');
  });
});
