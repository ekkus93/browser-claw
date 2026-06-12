import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button.tsx';
import { Badge } from './Badge.tsx';
import { Input } from './Input.tsx';
import { Toggle } from './Toggle.tsx';

describe('Button', () => {
  it('fires onClick and is disabled while loading', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Go</Button>);
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledOnce();

    rerender(
      <Button onClick={onClick} loading>
        Go
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Go' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });
});

describe('Badge', () => {
  it('renders its content', () => {
    render(<Badge tone="success">Connected</Badge>);
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });
});

describe('Input', () => {
  it('associates its label and surfaces errors accessibly', () => {
    render(<Input label="Base URL" error="Required" />);
    const input = screen.getByLabelText('Base URL');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Required')).toBeInTheDocument();
  });
});

describe('Toggle', () => {
  it('toggles aria-checked when clicked', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [on, setOn] = useState(false);
      return <Toggle checked={on} onCheckedChange={setOn} label="Enabled" />;
    }

    render(<Harness />);
    const sw = screen.getByRole('switch', { name: 'Enabled' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await user.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });
});
