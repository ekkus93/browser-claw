import 'fake-indexeddb/auto';
import { render, screen, waitFor, within } from '@testing-library/react';
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
  // Reset the online flag so an offline-status test can't leak into others.
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: true,
  });
  await db.provider_profiles.clear();
  await db.app_settings.clear();
  await db.audit_events.clear();
  await db.model_catalog.clear();
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

  it('shows an offline status banner when the browser is offline', async () => {
    // Honest availability status (Phase 8.1): when offline, downloads / runtime
    // fetch / remote provider tests can't work, so the screen says so.
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    renderModels();
    expect(await screen.findByText(/You're offline/)).toBeInTheDocument();
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

    // The failure must also be VISIBLE, not just audited: the provider's health
    // badge reflects the CORS-class failure (cors_error -> "CORS issue").
    expect((await screen.findAllByText('CORS issue')).length).toBeGreaterThan(
      0,
    );
  });

  it('keys llama-server health by its provider id, not its kind', async () => {
    // Regression guard for the health ID mapping: the llama-server card must
    // store its test result under the provider id 'llama-server', never under
    // the kind 'llama_server' — otherwise the sidebar would read 'unconfigured'
    // forever even after a real test.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('network down'))),
    );
    const user = userEvent.setup();
    const store = renderModels();

    const heading = await screen.findByRole('heading', {
      name: 'llama-server',
    });
    const card = heading.closest('div.rounded-card');
    expect(card).not.toBeNull();
    await user.click(
      within(card as HTMLElement).getByRole('button', {
        name: 'Test',
      }),
    );

    await waitFor(() =>
      expect(store.getState().providers.health['llama-server']).toBeDefined(),
    );
    // The kind must never be used as the health key.
    expect(store.getState().providers.health['llama_server']).toBeUndefined();
    expect(store.getState().providers.health['llama-server']).not.toBe(
      'unconfigured',
    );
  });

  it('adds a user-provided HF model and discovers its size/license', async () => {
    // Stub HF: HEAD -> size, models API -> license.
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) =>
        init?.method === 'HEAD'
          ? Promise.resolve(
              new Response(null, { headers: { 'content-length': '2048' } }),
            )
          : Promise.resolve(
              new Response(JSON.stringify({ cardData: { license: 'mit' } }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            ),
      ),
    );
    const user = userEvent.setup();
    renderModels();

    await user.type(screen.getByLabelText('Hugging Face repo'), 'owner/name');
    await user.type(screen.getByLabelText('GGUF file'), 'model.gguf');
    await user.click(screen.getByRole('button', { name: 'Add model' }));

    // It appears in the browser-local models table...
    expect(
      await screen.findByText('owner/name · model.gguf'),
    ).toBeInTheDocument();
    // ...the discovered license shows and the size persists for the quota check.
    expect(await screen.findByText(/License: mit/i)).toBeInTheDocument();
    await waitFor(async () => {
      const row = await db.model_catalog.get('hf:owner/name/model.gguf');
      expect(row?.sizeBytes).toBe(2048);
      expect(row?.license).toBe('mit');
    });
  });

  it('still adds a model but warns when HF metadata is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('network down'))),
    );
    const user = userEvent.setup();
    renderModels();

    await user.type(screen.getByLabelText('Hugging Face repo'), 'owner/name');
    await user.type(screen.getByLabelText('GGUF file'), 'model.gguf');
    await user.click(screen.getByRole('button', { name: 'Add model' }));

    // The model is still added (validation passed)...
    expect(
      await screen.findByText('owner/name · model.gguf'),
    ).toBeInTheDocument();
    // ...but the user is warned that metadata couldn't be fetched.
    expect(
      await screen.findByText('Model metadata unavailable'),
    ).toBeInTheDocument();
  });

  it('rejects an invalid HF model with a reason and persists nothing', async () => {
    const user = userEvent.setup();
    renderModels();

    await user.type(screen.getByLabelText('Hugging Face repo'), 'not-a-repo');
    await user.type(screen.getByLabelText('GGUF file'), 'model.gguf');
    await user.click(screen.getByRole('button', { name: 'Add model' }));

    expect(await screen.findByText(/must look like/i)).toBeInTheDocument();
    expect(await db.model_catalog.count()).toBe(0);
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
    // No-op honesty: the Download action must be DISABLED when it can't run,
    // never a button that looks live but silently does nothing.
    for (const button of await screen.findAllByRole('button', {
      name: 'Download',
    })) {
      expect(button).toBeDisabled();
    }
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

  it('reflects a truthful error status in the model row after a failed download', async () => {
    // Integration (TODO 11.3): a failed download must leave the model in a
    // truthful 'error' state — never a false 'ready' — both in the store and the
    // visible row. Worker is stubbed so Download is enabled; CDN consent stays
    // at its fail-closed default so the click fails.
    vi.stubGlobal('Worker', class {});
    const user = userEvent.setup();
    const store = renderModels();

    await user.click(
      (await screen.findAllByRole('button', { name: 'Download' }))[0]!,
    );

    await waitFor(() =>
      expect(store.getState().models.downloads['smollm2-135m']?.status).toBe(
        'error',
      ),
    );
    expect(store.getState().models.downloads['smollm2-135m']?.status).not.toBe(
      'ready',
    );
    expect(await screen.findByText(/^error/)).toBeInTheDocument();
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
