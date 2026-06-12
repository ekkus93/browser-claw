import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';
import skillsReducer from '../store/slices/skillsSlice.ts';
import auditReducer from '../store/slices/auditSlice.ts';
import { ToastProvider } from '../components/ui/Toast.tsx';
import { db } from '../db/db.ts';
import SkillsScreen from './SkillsScreen.tsx';

function renderSkills() {
  const store = configureStore({
    reducer: { skills: skillsReducer, audit: auditReducer },
  });
  render(
    <Provider store={store}>
      <ToastProvider>
        <SkillsScreen />
      </ToastProvider>
    </Provider>,
  );
  return store;
}

describe('SkillsScreen', () => {
  it('seeds bundled skills', async () => {
    renderSkills();
    expect(
      await screen.findByRole('button', { name: /web-search/ }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: /summarize-pdf/ }),
    ).toBeInTheDocument();
  });

  it('enables a skill and shows its permissions', async () => {
    const user = userEvent.setup();
    renderSkills();
    const toggle = await screen.findByRole('switch', {
      name: 'Enable web-search',
    });
    await user.click(toggle);

    await waitFor(async () => {
      const skill = await db.skills.get('web-search');
      expect(skill?.enabled).toBe(true);
    });

    await user.click(screen.getByRole('tab', { name: 'Permissions' }));
    expect(screen.getByText('Network access')).toBeInTheDocument();
  });
});
