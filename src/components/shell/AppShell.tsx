import type { ReactNode } from 'react';
import { TopStatusBar, type TopStatusBarProps } from './TopStatusBar.tsx';
import { SidebarNav, type SidebarNavProps } from './SidebarNav.tsx';

export interface AppShellProps {
  children: ReactNode;
  /** Optional right inspector panel; omit on screens that don't need it. */
  inspector?: ReactNode;
  topBar?: TopStatusBarProps;
  sidebar?: SidebarNavProps;
}

/**
 * Shared application shell: top status bar across the top, then a row of
 * left nav rail, main content, and an optional right inspector. Widths come
 * from the canonical layout tokens (--bc-left-nav-width, -right-inspector-width).
 */
export function AppShell({
  children,
  inspector,
  topBar,
  sidebar,
}: AppShellProps) {
  return (
    <div className="grid h-screen grid-rows-[auto_1fr] overflow-hidden bg-background text-text">
      <TopStatusBar {...topBar} />

      <div
        className="grid min-h-0"
        style={{
          gridTemplateColumns: inspector
            ? 'var(--bc-left-nav-width) minmax(0,1fr) var(--bc-right-inspector-width)'
            : 'var(--bc-left-nav-width) minmax(0,1fr)',
        }}
      >
        <SidebarNav {...sidebar} />
        <main className="min-w-0 overflow-y-auto">{children}</main>
        {inspector}
      </div>
    </div>
  );
}
