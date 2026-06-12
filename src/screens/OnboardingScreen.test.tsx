import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';
import appReducer from '../store/slices/appSlice.ts';
import providersReducer from '../store/slices/providersSlice.ts';
import storageReducer from '../store/slices/storageSlice.ts';
import OnboardingScreen from './OnboardingScreen.tsx';

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
    expect(screen.getByText('Chat screen')).toBeInTheDocument();
    expect(store.getState().app.onboardingComplete).toBe(true);
  });

  it('disables Back on the first step', () => {
    renderOnboarding();
    expect(screen.getByRole('button', { name: /back/i })).toBeDisabled();
  });
});
