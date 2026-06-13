import { Navigate } from 'react-router-dom';
import { useAppSelector } from '../../store/hooks.ts';

/**
 * Landing decision for the index route `/`: first-run users see onboarding;
 * returning users (onboarding already completed and persisted) go straight to
 * chat. Renders nothing until durable state has hydrated, so a returning user
 * is never briefly bounced to onboarding before the persisted flag is read.
 * Only the index route is gated — deep links (e.g. /chat) are untouched.
 */
export function IndexRedirect() {
  const hydrated = useAppSelector((state) => state.app.hydrated);
  const onboardingComplete = useAppSelector(
    (state) => state.app.onboardingComplete,
  );
  if (!hydrated) return null;
  return <Navigate to={onboardingComplete ? '/chat' : '/onboarding'} replace />;
}
