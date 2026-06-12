import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from './Card.tsx';

describe('Card', () => {
  it('renders its composable parts', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle description="OpenAI-compatible endpoint">
            Anthropic
          </CardTitle>
        </CardHeader>
        <CardContent>Body content</CardContent>
        <CardFooter>Footer content</CardFooter>
      </Card>,
    );

    expect(
      screen.getByRole('heading', { name: 'Anthropic' }),
    ).toBeInTheDocument();
    expect(screen.getByText('OpenAI-compatible endpoint')).toBeInTheDocument();
    expect(screen.getByText('Body content')).toBeInTheDocument();
    expect(screen.getByText('Footer content')).toBeInTheDocument();
  });

  it('omits the description when none is given', () => {
    render(<CardTitle>Just a title</CardTitle>);
    expect(
      screen.getByRole('heading', { name: 'Just a title' }),
    ).toBeInTheDocument();
  });

  it('forwards custom class names', () => {
    render(<Card data-testid="card" className="w-80" />);
    expect(screen.getByTestId('card')).toHaveClass('w-80');
  });
});
