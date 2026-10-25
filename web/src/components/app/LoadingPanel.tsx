// LoadingPanel keeps unavailable initial requests distinct from cached stale data.
export function LoadingPanel({ title, message }: { title: string; message: string }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 break-words text-sm text-text-muted" role="status">{message}</p>
    </section>
  );
}
