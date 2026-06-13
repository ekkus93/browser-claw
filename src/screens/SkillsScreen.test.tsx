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

  it('imports a skill: reviews permissions, installs, enables, and audits', async () => {
    // Integration (TODO 11.3): importing a skill must show a permission-review
    // dialog before installing, and both install + enable must be audited.
    const user = userEvent.setup();
    renderSkills();
    await screen.findByRole('button', { name: /web-search/ });

    const skillMd = [
      '---',
      'name: note-taker',
      'version: 1.0.0',
      'description: Takes notes.',
      'tools: [Page Reader]',
      'read: skills/note-taker/data/**',
      'write: skills/note-taker/out/**',
      'network: false',
      '---',
      'Take notes.',
    ].join('\n');
    const file = new File([skillMd], 'SKILL.md', { type: 'text/markdown' });

    await user.upload(screen.getByLabelText('Import skill file'), file);

    // Permission review happens before anything is installed.
    expect(await screen.findByText('Install note-taker?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Install' }));
    expect(await screen.findByText('Installed note-taker')).toBeInTheDocument();

    // Then enable it.
    await user.click(
      await screen.findByRole('switch', { name: 'Enable note-taker' }),
    );
    await waitFor(async () =>
      expect((await db.skills.get('note-taker'))?.enabled).toBe(true),
    );

    // Both the install and the enable are durably audited for this skill.
    const types = (await db.audit_events.toArray())
      .filter((e) => e.skillId === 'note-taker')
      .map((e) => e.type);
    expect(types).toContain('skill_installed');
    expect(types).toContain('skill_enabled');
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
