import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';
import providersReducer from '../store/slices/providersSlice.ts';
import modelsReducer from '../store/slices/modelsSlice.ts';
import runtimeReducer, { runtimeReady } from '../store/slices/runtimeSlice.ts';
import SettingsScreen from './SettingsScreen.tsx';

function renderSettings() {
  const store = configureStore({
    reducer: {
      providers: providersReducer,
      models: modelsReducer,
      runtime: runtimeReducer,
    },
  });
  store.dispatch(runtimeReady());
  render(
    <Provider store={store}>
      <SettingsScreen />
    </Provider>,
  );
  return store;
}

describe('SettingsScreen', () => {
  it('renders the configuration sections', () => {
    renderSettings();
    for (const section of [
      'General',
      'Models',
      'Security',
      'Storage',
      'Skills',
      'Developer',
    ]) {
      expect(
        screen.getByRole('heading', { name: section }),
      ).toBeInTheDocument();
    }
  });

  it('toggles a setting and resets the runtime', async () => {
    const user = userEvent.setup();
    const store = renderSettings();

    const approval = screen.getByRole('switch', {
      name: 'Require approval by default',
    });
    expect(approval).toHaveAttribute('aria-checked', 'true');
    await user.click(approval);
    expect(approval).toHaveAttribute('aria-checked', 'false');

    expect(store.getState().runtime.status).toBe('ready');
    await user.click(screen.getByRole('button', { name: 'Reset runtime' }));
    expect(store.getState().runtime.status).toBe('initializing');
  });
});
