interface BrandMarkProps {
  size?: number;
}

/**
 * BrowserClaw logo mark — a stylized claw formed from three sweeping strokes
 * inside a rounded tile. Drawn from tokens so it stays on-palette.
 */
export function BrandMark({ size = 28 }: BrandMarkProps) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-button bg-primary text-surface shadow-sm"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        width={size * 0.62}
        height={size * 0.62}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M17 4c-5 1-9 4-9 9 0 3 2 6 5 7" />
        <path d="M19 9c-3 .5-5 2.5-5 5" />
        <path d="M6 14c-1 .8-2 2-2 3.5" />
      </svg>
    </span>
  );
}
