import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import AppLayout from './AppLayout.tsx';
import { store } from './store/store.ts';

function renderShell() {
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/chat']}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/chat" element={<div>CHAT</div>} />
            <Route path="/settings" element={<div>SETTINGS SCREEN</div>} />
            <Route path="/models" element={<div>MODELS SCREEN</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
}

describe('AppLayout', () => {
  it('navigates to /settings when the top-bar Settings button is clicked', async () => {
    const user = userEvent.setup();
    renderShell();

    // The affordance must do something real, not be a silent no-op.
    expect(screen.getByText('CHAT')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /settings/i }));
    expect(await screen.findByText('SETTINGS SCREEN')).toBeInTheDocument();
  });

  it('navigates to /models when the top-bar provider/model button is clicked', async () => {
    const user = userEvent.setup();
    renderShell();

    // The provider/model button must route somewhere real, not be a no-op.
    expect(screen.getByText('CHAT')).toBeInTheDocument();
    await user.click(screen.getByTitle('Change active model or provider'));
    expect(await screen.findByText('MODELS SCREEN')).toBeInTheDocument();
  });
});
