import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';
import skillsReducer from '../store/slices/skillsSlice.ts';
import SkillsScreen from './SkillsScreen.tsx';

function renderSkills() {
  const store = configureStore({ reducer: { skills: skillsReducer } });
  render(
    <Provider store={store}>
      <SkillsScreen />
    </Provider>,
  );
  return store;
}

describe('SkillsScreen', () => {
  it('lists installed and bundled skills and selects one by default', () => {
    renderSkills();
    expect(
      screen.getByRole('heading', { name: 'Installed Skills' }),
    ).toBeInTheDocument();
    // summarize-pdf appears in the list and as the default-selected detail title
    expect(
      screen.getByRole('heading', { name: 'summarize-pdf' }),
    ).toBeInTheDocument();
    expect(screen.getByText('web-search')).toBeInTheDocument();
  });

  it('enables a skill via its toggle', async () => {
    const user = userEvent.setup();
    const store = renderSkills();
    await user.click(screen.getByRole('switch', { name: 'Enable web-search' }));
    expect(store.getState().skills.enabledIds).toContain('web-search');
  });

  it('switches the detail tabs', async () => {
    const user = userEvent.setup();
    renderSkills();
    await user.click(screen.getByRole('tab', { name: 'Permissions' }));
    expect(screen.getByText('Allowed tools')).toBeInTheDocument();
    expect(screen.getByText('Network access')).toBeInTheDocument();
  });
});
