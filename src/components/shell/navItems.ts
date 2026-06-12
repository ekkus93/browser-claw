import {
  MessageSquare,
  Boxes,
  Database,
  Puzzle,
  Brain,
  ScrollText,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
}

/**
 * Primary sidebar destinations. Paths match the canonical routes in
 * BROWSERCLAW_UI_SPEC.md; the real screens are built in Phase 6.
 */
export const NAV_ITEMS: NavItem[] = [
  { id: 'chat', label: 'Chat', path: '/chat', icon: MessageSquare },
  { id: 'models', label: 'Models', path: '/models', icon: Boxes },
  { id: 'storage', label: 'Storage', path: '/storage', icon: Database },
  { id: 'skills', label: 'Skills', path: '/skills', icon: Puzzle },
  { id: 'memories', label: 'Memories', path: '/memories', icon: Brain },
  { id: 'audit', label: 'Audit', path: '/audit', icon: ScrollText },
  { id: 'settings', label: 'Settings', path: '/settings', icon: Settings },
];
