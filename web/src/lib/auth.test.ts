import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAppToken,
  getAppToken,
  getAuthRevision,
  persistAppToken,
  reportUnauthorized,
  restoreAppToken,
  setAppToken,
  subscribeUnauthorized,
} from "./auth";

const key = "unraid-mobile.app-token";
let storage: Storage;

beforeEach(() => {
  const values = new Map<string, string>();
  storage = {
    getItem: vi.fn((name: string) => values.get(name) ?? null),
    setItem: vi.fn((name: string, value: string) => void values.set(name, value)),
    removeItem: vi.fn((name: string) => void values.delete(name)),
    clear: vi.fn(() => values.clear()),
    key: vi.fn(() => null),
    get length() { return values.size; },
  };
  vi.stubGlobal("sessionStorage", storage);
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => { throw new Error("Forbidden storage"); }),
    setItem: vi.fn(() => { throw new Error("Forbidden storage"); }),
  });
  clearAppToken();
  vi.clearAllMocks();
});

afterEach(() => {
  clearAppToken();
  vi.unstubAllGlobals();
});

describe("app credentials", () => {
  it("keeps untrimmed credentials transient until explicitly persisted", () => {
    setAppToken("  exact token  ");
    expect(getAppToken()).toBe("  exact token  ");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    persistAppToken();
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(key, "  exact token  ");
  });

  it("restores only the designated session storage key", () => {
    storage.setItem(key, "stored token");
    setAppToken(null);
    expect(restoreAppToken()).toBe("stored token");
    expect(getAppToken()).toBe("stored token");
    expect(storage.getItem).toHaveBeenCalledExactlyOnceWith(key);
  });

  it("preserves empty credentials without trimming or falling back to storage", () => {
    setAppToken("");
    expect(getAppToken()).toBe("");
    persistAppToken();
    expect(storage.setItem).toHaveBeenCalledWith(key, "");
  });

  it("clears memory and persisted credentials and advances the revision", () => {
    setAppToken("token");
    persistAppToken();
    const revision = getAuthRevision();
    clearAppToken();
    expect(getAppToken()).toBeNull();
    expect(storage.getItem(key)).toBeNull();
    expect(getAuthRevision()).toBeGreaterThan(revision);
  });

  it("removes persistence when the transient token is null", () => {
    storage.setItem(key, "previous");
    setAppToken(null);
    persistAppToken();
    expect(storage.getItem(key)).toBeNull();
  });

  it("restores safely when session storage access is blocked", () => {
    vi.stubGlobal("sessionStorage", undefined);
    expect(restoreAppToken()).toBeNull();
    expect(() => clearAppToken()).not.toThrow();
  });

  it("tolerates a throwing storage getter during restore and clear", () => {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get: () => { throw new Error("Storage blocked"); },
    });
    expect(restoreAppToken()).toBeNull();
    expect(() => clearAppToken()).not.toThrow();
  });

  it("reports a safe persist failure to the UI without changing transient credentials", () => {
    setAppToken("secret");
    vi.mocked(storage.setItem).mockImplementation(() => {
      throw new Error("secret storage details");
    });
    expect(() => persistAppToken()).toThrow();
    try { persistAppToken(); } catch (error) {
      expect(String(error)).not.toContain("secret");
    }
    expect(getAppToken()).toBe("secret");
  });

  it("ignores old unauthorized reports even after setting the same token", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeUnauthorized(listener);
    setAppToken("token");
    const oldRevision = getAuthRevision();
    setAppToken("token");
    expect(getAuthRevision()).toBeGreaterThan(oldRevision);
    reportUnauthorized(oldRevision);
    expect(listener).not.toHaveBeenCalled();
    reportUnauthorized(getAuthRevision());
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    reportUnauthorized(getAuthRevision());
    expect(listener).toHaveBeenCalledOnce();
  });
});
