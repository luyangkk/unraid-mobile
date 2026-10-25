const storageKey = "unraid-mobile.app-token";
let appToken: string | null = null;
let authRevision = 0;
const unauthorizedListeners = new Set<() => void>();
const authChangeListeners = new Set<() => void>();

// Return the active transient credential.
export function getAppToken(): string | null {
  return appToken;
}

// Replace the transient credential without persisting it.
export function setAppToken(token: string | null): void {
  appToken = token;
  authRevision++;
  for (const listener of authChangeListeners) listener();
}

// Restore a credential from session storage.
export function restoreAppToken(): string | null {
  let token: string | null = null;
  try {
    token = sessionStorage.getItem(storageKey);
  } catch {
    // Browsers may deny storage access even when the API exists.
  }
  setAppToken(token);
  return token;
}

// Persist the currently active credential.
export function persistAppToken(): void {
  try {
    if (appToken === null) sessionStorage.removeItem(storageKey);
    else sessionStorage.setItem(storageKey, appToken);
  } catch {
    throw new Error("Couldn't save the session token.");
  }
}

// Discard transient and persisted credentials.
export function clearAppToken(): void {
  setAppToken(null);
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    // Memory must still be cleared when storage is unavailable.
  }
}

// Observe unauthorized responses from the current session.
export function subscribeUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

// Stop credential-bound transports synchronously when their session changes.
export function subscribeAuthChange(listener: () => void): () => void {
  authChangeListeners.add(listener);
  return () => authChangeListeners.delete(listener);
}

// Return the current credential session revision.
export function getAuthRevision(): number {
  return authRevision;
}

// Report unauthorized responses only for the current session.
export function reportUnauthorized(revision: number): void {
  if (revision !== authRevision) return;
  for (const listener of unauthorizedListeners) listener();
}
