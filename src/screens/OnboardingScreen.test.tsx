import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { afterEach, describe, expect, it } from 'vitest';
import appReducer from '../store/slices/appSlice.ts';
import providersReducer from '../store/slices/providersSlice.ts';
import storageReducer from '../store/slices/storageSlice.ts';
import OnboardingScreen from './OnboardingScreen.tsx';
import { db } from '../db/db.ts';
import { getOnboardingComplete } from '../settings/appSettings.ts';
import { getActiveProviderId } from '../providers/providerProfiles.ts';

function renderOnboarding() {
  const store = configureStore({
    reducer: {
      app: appReducer,
      providers: providersReducer,
      storage: storageReducer,
    },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/onboarding']}>
        <Routes>
          <Route path="/onboarding" element={<OnboardingScreen />} />
          <Route path="/chat" element={<div>Chat screen</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
  return store;
}

describe('OnboardingScreen', () => {
  afterEach(async () => {
    await db.app_settings.clear();
  });

  it('walks through the steps and finishes into chat', async () => {
    const user = userEvent.setup();
    const store = renderOnboarding();

    expect(
      screen.getByRole('heading', { name: 'Choose inference mode' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Recommended')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /continue/i })); // -> storage
    expect(
      screen.getByRole('heading', { name: 'Set up storage' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i })); // -> configure
    expect(
      screen.getByRole('heading', { name: 'Configure model' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i })); // -> finish
    expect(screen.getByText(/all set/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /finish setup/i }));
    expect(await screen.findByText('Chat screen')).toBeInTheDocument();
    expect(store.getState().app.onboardingComplete).toBe(true);
    // Completion is persisted durably so the index route skips onboarding next
    // reload — not just held in Redux for this session.
    await waitFor(async () =>
      expect(await getOnboardingComplete(db)).toBe(true),
    );
  });

  it('persists the remote provider selection durably', async () => {
    const user = userEvent.setup();
    renderOnboarding();

    // Pick the remote (OpenAI/Anthropic) mode, then walk to the finish step.
    await user.click(
      screen.getByRole('button', { name: /Use OpenAI \/ Anthropic/i }),
    );
    await user.click(screen.getByRole('button', { name: /continue/i })); // -> storage
    await user.click(screen.getByRole('button', { name: /continue/i })); // -> configure
    expect(
      screen.getByRole('combobox', { name: /provider/i }),
    ).toHaveValue('anthropic');
    await user.click(screen.getByRole('button', { name: /continue/i })); // -> finish
    await user.click(screen.getByRole('button', { name: /finish setup/i }));

    expect(await screen.findByText('Chat screen')).toBeInTheDocument();
    // The selected provider is the durable active provider after reload.
    await waitFor(async () =>
      expect(await getActiveProviderId(db)).toBe('anthropic'),
    );
  });

  it('disables Back on the first step', () => {
    renderOnboarding();
    expect(screen.getByRole('button', { name: /back/i })).toBeDisabled();
  });
});
