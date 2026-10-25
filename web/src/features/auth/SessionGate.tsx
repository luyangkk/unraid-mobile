import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { getCapabilities } from "../../lib/api";
import {
  clearAppToken,
  getAppToken,
  persistAppToken,
  restoreAppToken,
  setAppToken,
  subscribeUnauthorized,
} from "../../lib/auth";
import { TokenForm } from "./TokenForm";

// SessionGate validates credentials before mounting any protected data consumers.
export function SessionGate({ children }: {
  children: (session: { logout: () => void; hasToken: boolean }) => ReactNode;
}) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<"checking" | "ready" | "required">("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verification = useRef<AbortController | null>(null);

  // endSession invalidates requests before removing protected cache and content.
  const endSession = useCallback((message: string | null) => {
    verification.current?.abort();
    verification.current = null;
    clearAppToken();
    void queryClient.cancelQueries();
    queryClient.clear();
    setBusy(false);
    setError(message);
    setState("required");
  }, [queryClient]);

  // validate admits the dashboard only after a fresh capabilities response.
  const validate = useCallback(async (persist: boolean) => {
    verification.current?.abort();
    const controller = new AbortController();
    verification.current = controller;
    setBusy(true);
    setError(null);
    try {
      const capabilities = await getCapabilities(undefined, controller.signal);
      if (controller.signal.aborted || verification.current !== controller) return;
      if (persist) persistAppToken();
      queryClient.setQueryData(["capabilities"], capabilities);
      verification.current = null;
      setBusy(false);
      setState("ready");
    } catch {
      if (controller.signal.aborted || verification.current !== controller) return;
      verification.current = null;
      // A transport failure does not invalidate saved credentials; discard candidates.
      if (persist) restoreAppToken();
      setBusy(false);
      setError("Couldn't verify access. Check the connection and try again.");
    }
  }, [queryClient]);

  useEffect(() => {
    const unsubscribe = subscribeUnauthorized(() => {
      endSession("Authentication required. Check APP_TOKEN and try again.");
    });
    restoreAppToken();
    void validate(false);
    return () => {
      unsubscribe();
      verification.current?.abort();
      verification.current = null;
    };
  }, [endSession, validate]);

  useEffect(() => {
    // retryOnline revalidates an offline cold boot before admitting protected consumers.
    function retryOnline() {
      if (state !== "checking" || verification.current) return;
      restoreAppToken();
      void validate(false);
    }
    window.addEventListener("online", retryOnline);
    return () => window.removeEventListener("online", retryOnline);
  }, [state, validate]);

  if (state === "ready") {
    return children({ logout: () => endSession(null), hasToken: getAppToken() !== null });
  }
  return (
    <main className="mx-auto min-h-dvh max-w-md px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))] text-slate-100">
      <p className="mb-7 text-sm text-slate-400">Unraid Mobile</p>
      {state === "required" ? (
        <TokenForm busy={busy} error={error} onSubmit={(token) => {
          setAppToken(token);
          void validate(true);
        }} />
      ) : (
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <p role="status" className="text-sm text-slate-400">
            {busy ? "Checking server access…" : "Server access could not be verified."}
          </p>
          {error ? <p role="alert" className="mt-3 text-sm text-amber-300">{error}</p> : null}
          {!busy ? <Button className="mt-4" onClick={() => {
            restoreAppToken();
            void validate(false);
          }}>Retry connection</Button> : null}
        </section>
      )}
    </main>
  );
}
