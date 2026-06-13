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
  await db.audit_events.clear();
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

  it('writes a durable audit event when a provider is tested', async () => {
    // A user-initiated test is a real action and must land in the durable audit
    // log — with only the provider id and verdict, never the API key.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
      ),
    );
    const user = userEvent.setup();
    renderModels();
    await screen.findByRole('heading', { name: 'OpenAI' });

    await user.click(screen.getAllByRole('button', { name: 'Test' })[0]!);

    await waitFor(async () => {
      const rows = await db.audit_events
        .where('type')
        .equals('provider.test_succeeded')
        .toArray();
      expect(rows).toHaveLength(1);
    });
    const [event] = await db.audit_events
      .where('type')
      .equals('provider.test_succeeded')
      .toArray();
    expect(event?.source).toBe('provider');
    expect(event?.status).toBe('success');
    expect(event?.providerId).toBe('openai');
    // The verdict is recorded; no credential material ever is.
    expect(JSON.stringify(event)).not.toContain('sk-');
  });

  it('writes a failure audit event when a provider test fails', async () => {
    // OpenAI is cross-origin, so a thrown fetch is a CORS-class failure — the
    // test must record that honest failure, not a success.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('network down'))),
    );
    const user = userEvent.setup();
    renderModels();
    await screen.findByRole('heading', { name: 'OpenAI' });

    await user.click(screen.getAllByRole('button', { name: 'Test' })[0]!);

    await waitFor(async () => {
      const rows = await db.audit_events
        .where('type')
        .equals('provider.test_failed')
        .toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('failure');
    });
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

  it('shows the unavailable banner when wllama is unsupported', async () => {
    // Force the unsupported path so the warning is deterministic regardless of
    // the jsdom feature set: the user must be told browser-local models can't
    // run here, not left with a silently dead Download button.
    vi.stubGlobal('WebAssembly', undefined);
    renderModels();

    expect(
      await screen.findByText(/browser-local models can.+run here/i),
    ).toBeInTheDocument();
  });

  it('shows a visible, audited error when a model download fails', async () => {
    // Make wllama "supported" so Download is enabled, but leave CDN consent at
    // its fail-closed default — so the click is blocked and must surface as a
    // toast (visible) and a durable failure audit (auditable), never silently.
    vi.stubGlobal('Worker', class {});
    const user = userEvent.setup();
    renderModels();

    await user.click(
      (await screen.findAllByRole('button', { name: 'Download' }))[0]!,
    );

    expect(
      await screen.findByText('Could not download the model.'),
    ).toBeInTheDocument();
    await waitFor(async () => {
      const rows = await db.audit_events
        .where('type')
        .equals('model.download_failed')
        .toArray();
      expect(rows[0]?.status).toBe('failure');
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
