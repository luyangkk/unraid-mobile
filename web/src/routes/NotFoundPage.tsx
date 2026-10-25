import { Link } from "@tanstack/react-router";

// NotFoundPage keeps unknown client URLs recoverable through the Home entry.
export function NotFoundPage() {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-xl font-semibold">Not Found</h2>
      <p className="mt-2 text-sm text-text-muted">This page could not be found.</p>
      <Link to="/" className="mt-4 inline-flex min-h-11 items-center rounded-lg px-3 text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">Return Home</Link>
    </section>
  );
}
