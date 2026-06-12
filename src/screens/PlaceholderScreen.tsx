interface PlaceholderScreenProps {
  title: string;
  phase: string;
}

/**
 * Temporary stand-in for screens not yet built. Phase 6 replaces each of
 * these with the real screen rendered from its mockup.
 */
export function PlaceholderScreen({ title, phase }: PlaceholderScreenProps) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md rounded-card border border-dashed border-border bg-surface p-8 text-center">
        <h1 className="text-xl font-bold text-text">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          This screen is part of the design system shell. Its full
          implementation arrives in {phase}.
        </p>
      </div>
    </div>
  );
}
