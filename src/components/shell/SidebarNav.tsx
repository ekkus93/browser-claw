import { NavLink } from 'react-router';
import { NAV_ITEMS } from './navItems.ts';
import { StatusFooter, type StatusFooterProps } from './StatusFooter.tsx';

export interface SidebarNavProps {
  footer?: StatusFooterProps;
}

/**
 * Left navigation rail. Active item: light-blue background, blue semibold
 * label (per the canonical mockup). Uses NavLink so the active state tracks
 * the router and the items are keyboard-reachable.
 */
export function SidebarNav({ footer }: SidebarNavProps) {
  return (
    <nav
      aria-label="Primary"
      className="flex h-full flex-col border-r border-border bg-surface"
    >
      <ul className="flex flex-col gap-0.5 p-3">
        {NAV_ITEMS.map(({ id, label, path, icon: Icon }) => (
          <li key={id}>
            <NavLink
              to={path}
              className={({ isActive }) =>
                [
                  'group flex items-center gap-3 rounded-button px-3 py-2 text-sm transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                  isActive
                    ? 'bg-primary-subtle font-semibold text-primary'
                    : 'font-medium text-muted hover:bg-surface-subtle hover:text-text',
                ].join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={`size-4.5 shrink-0 ${
                      isActive
                        ? 'text-primary'
                        : 'text-muted-subtle group-hover:text-muted'
                    }`}
                    aria-hidden="true"
                  />
                  {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      <StatusFooter {...footer} />
    </nav>
  );
}
