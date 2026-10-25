import { useState } from "react";
import { Button } from "../../components/ui/button";

// TokenForm collects a transient credential without password persistence.
export function TokenForm({ busy, error, onSubmit }: {
  busy: boolean;
  error: string | null;
  onSubmit: (token: string) => void;
}) {
  const [token, setToken] = useState("");
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h1 className="text-xl font-semibold">API authentication</h1>
      <p className="mt-2 text-sm text-text-muted">
        Enter the APP_TOKEN configured on your server.
      </p>
      <form className="mt-5 grid gap-3" onSubmit={(event) => {
        event.preventDefault();
        if (!busy && token !== "") {
          onSubmit(token);
          setToken("");
        }
      }}>
        <label className="text-sm font-medium" htmlFor="app-token">APP_TOKEN</label>
        <input
          id="app-token"
          name="app-token"
          type="password"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={token}
          onChange={(event) => setToken(event.target.value)}
          disabled={busy}
          aria-invalid={!!error}
          aria-describedby={error ? "token-error token-guidance" : "token-guidance"}
          className="min-h-11 w-full rounded-xl border border-control-border bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:bg-surface-muted disabled:text-text-muted"
        />
        {error ? <p id="token-error" role="alert" className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={busy || token === ""}>
          {busy ? "Verifying…" : "Connect"}
        </Button>
      </form>
      <p id="token-guidance" className="mt-5 text-xs leading-relaxed text-text-muted">
        Use on a controlled LAN. Bearer tokens do not encrypt traffic.
        For other networks, use HTTPS, Tailscale or WireGuard.
        The token stays in this tab’s sessionStorage until you clear it or close the tab.
      </p>
    </section>
  );
}
