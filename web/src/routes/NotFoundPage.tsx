import { Link } from "@tanstack/react-router";

// NotFoundPage keeps unknown client URLs recoverable through the Home entry.
export function NotFoundPage() {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h2 className="text-xl font-semibold">Not Found</h2>
      <p className="mt-2 text-sm text-slate-400">This page could not be found.</p>
      <Link to="/" className="mt-4 inline-flex min-h-11 items-center rounded-lg px-3 text-cyan-300 focus-visible:outline-2 focus-visible:outline-cyan-300">Return Home</Link>
    </section>
  );
}
