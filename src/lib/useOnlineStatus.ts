import { useEffect, useState } from 'react';

/**
 * Live browser online/offline status, kept in sync with the `online`/`offline`
 * window events. Used to surface an honest "you're offline" status where the app
 * needs the network (model downloads, the CDN runtime fetch, remote providers) —
 * so a failure reads as "offline", not a mysterious error. Defaults to online
 * when there's no `navigator` (SSR/non-browser).
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  return online;
}
