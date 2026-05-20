/**
 * Lightweight auth-state pub/sub.
 *
 * Lets screens signal RootNavigator to re-check the stored token after a
 * login or logout without importing the navigator directly (which would
 * create an import cycle). This is the "global auth event emitter" the
 * RootNavigator and api.ts interceptor TODOs referred to.
 */
type AuthListener = () => void;

const listeners = new Set<AuthListener>();

/** Notify every subscriber that the authentication state may have changed. */
export function notifyAuthChanged(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Subscribe to auth-state changes. Returns an unsubscribe function. */
export function onAuthChanged(listener: AuthListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
