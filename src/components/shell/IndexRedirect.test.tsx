import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import appReducer, {
  hydrated,
  onboardingCompleted,
} from '../../store/slices/appSlice.ts';
import { IndexRedirect } from './IndexRedirect.tsx';

function renderIndex() {
  const store = configureStore({ reducer: { app: appReducer } });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<IndexRedirect />} />
          <Route path="/onboarding" element={<div>ONBOARDING</div>} />
          <Route path="/chat" element={<div>CHAT</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
  return store;
}

describe('IndexRedirect', () => {
  it('renders nothing until durable state has hydrated', () => {
    renderIndex();
    expect(screen.queryByText('ONBOARDING')).not.toBeInTheDocument();
    expect(screen.queryByText('CHAT')).not.toBeInTheDocument();
  });

  it('sends a first-run user to onboarding once hydrated', async () => {
    const store = renderIndex();
    store.dispatch(hydrated());
    expect(await screen.findByText('ONBOARDING')).toBeInTheDocument();
  });

  it('sends a returning (completed) user straight to chat', async () => {
    const store = renderIndex();
    store.dispatch(onboardingCompleted());
    store.dispatch(hydrated());
    expect(await screen.findByText('CHAT')).toBeInTheDocument();
  });
});
