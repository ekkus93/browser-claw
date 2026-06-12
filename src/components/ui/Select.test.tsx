import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Select } from './Select.tsx';

function renderSelect(props?: Partial<React.ComponentProps<typeof Select>>) {
  return render(
    <Select label="Provider" {...props}>
      <option value="openai">OpenAI</option>
      <option value="anthropic">Anthropic</option>
      <option value="ollama">Ollama</option>
    </Select>,
  );
}

describe('Select', () => {
  it('associates its label and honours the default value', () => {
    renderSelect({ defaultValue: 'anthropic' });
    expect(screen.getByLabelText('Provider')).toHaveValue('anthropic');
  });

  it('changes value when the user picks an option', async () => {
    const user = userEvent.setup();
    renderSelect({ defaultValue: 'anthropic' });
    const select = screen.getByLabelText('Provider');
    await user.selectOptions(select, 'ollama');
    expect(select).toHaveValue('ollama');
  });

  it('marks itself invalid and shows the error message', () => {
    renderSelect({ error: 'Pick a provider' });
    expect(screen.getByLabelText('Provider')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByText('Pick a provider')).toBeInTheDocument();
  });
});
