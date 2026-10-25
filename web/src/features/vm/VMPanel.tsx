import { Monitor } from "lucide-react";
import type { VMDomain, VMSnapshot } from "../../lib/api";
import { formatBytes, formatUptime } from "../../lib/system";

const stateLabels: Record<string, string> = {
  running: "Running", blocked: "Blocked", paused: "Paused", shutdown: "Shutting down",
  shutoff: "Shut off", crashed: "Crashed", pmsuspended: "Suspended", unknown: "Unknown",
};

// VMPanel renders a read-only full or running-only snapshot with independent freshness.
export function VMPanel({ snapshot, overview = false, stale = false, errorMessage }: {
  snapshot: VMSnapshot;
  overview?: boolean;
  stale?: boolean;
  errorMessage?: string;
}) {
  const groups: Record<"running" | "stopped" | "other", VMDomain[]> = { running: [], stopped: [], other: [] };
  for (const domain of snapshot.domains) {
    groups[domain.state === "running" ? "running" : domain.state === "shutoff" ? "stopped" : "other"].push(domain);
  }
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">VM</h2>
        {snapshot.available ? <span className="text-xs text-slate-400">{snapshot.summary.running} running · Read only</span> : null}
      </div>
      {stale ? (
        <div className="mt-3 break-words text-sm text-amber-200" role="status">
          <p>
            {errorMessage
              ? `VM refresh failed. Showing the last sample. ${errorMessage}`
              : "Showing the last sample."}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Sampled <time dateTime={snapshot.timestamp}>{snapshot.timestamp}</time>
          </p>
        </div>
      ) : null}
      <div className={stale ? "opacity-60" : ""}>
        {!snapshot.available ? (
          <p className="mt-3 break-words text-sm text-amber-200" role="status">{snapshot.reason || "VM data unavailable"}</p>
        ) : (
          <>
            {snapshot.domains.length === 0 ? <p className="mt-3 text-sm text-slate-400">No virtual machines configured</p> : (
              <>
                <div className="mt-4">
                  <h3 className="mb-3 text-sm font-medium">Running ({groups.running.length})</h3>
                  {groups.running.length === 0 ? <p className="text-sm text-slate-400">No running virtual machines</p> : groups.running.map((domain) => <VMCard key={domain.id} domain={domain} />)}
                </div>
                {!overview ? (
                  <details className="mt-3 border-t border-slate-800">
                    <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline-cyan-300">Stopped ({groups.stopped.length})</summary>
                    {groups.stopped.length === 0 ? <p className="text-sm text-slate-400">No stopped virtual machines</p> : groups.stopped.map((domain) => <VMCard key={domain.id} domain={domain} />)}
                  </details>
                ) : null}
                {!overview && groups.other.length > 0 ? (
                  <div className="mt-3 border-t border-slate-800 pt-3">
                    <h3 className="mb-3 text-sm font-medium">Other ({groups.other.length})</h3>
                    {groups.other.map((domain) => <VMCard key={domain.id} domain={domain} />)}
                  </div>
                ) : null}
              </>
            )}
          </>
        )}
        <Diagnostics messages={snapshot.diagnostics} label="VM diagnostics" />
      </div>
    </section>
  );
}

// VMCard presents assigned resources and reported state without inferred uptime.
function VMCard({ domain }: { domain: VMDomain }) {
  return (
    <article className="mb-3 rounded-xl bg-slate-950/60 p-4">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-800 text-cyan-300"><Monitor className="size-5" aria-hidden="true" /></div>
        <div className="min-w-0">
          <h4 className="break-words font-medium">{domain.name}</h4>
          <p className={`mt-1 text-sm ${domain.state === "running" ? "text-emerald-300" : "text-amber-200"}`}>{stateLabels[domain.state] || "Unknown"}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-2 gap-y-3 break-words text-sm tabular-nums">
        <div><p className="text-xs text-slate-400">Assigned CPU</p><p className="mt-1">{domain.vcpus === null ? "vCPU —" : `${domain.vcpus} vCPU`}</p></div>
        <div><p className="text-xs text-slate-400">Assigned RAM</p><p className="mt-1">{domain.memoryBytes === null ? "RAM —" : formatBytes(domain.memoryBytes)}</p></div>
        <p className="col-span-2 text-xs text-slate-400">Uptime {formatUptime(domain.uptimeSeconds)}</p>
      </div>
      <Diagnostics messages={domain.diagnostics} label="VM details" />
    </article>
  );
}

// Diagnostics keeps collection details available without expanding every card.
function Diagnostics({ messages, label }: { messages: string[]; label: string }) {
  return messages.length > 0 ? (
    <details className="mt-2 text-xs text-slate-400">
      <summary className="min-h-11 cursor-pointer py-3 focus-visible:outline-cyan-300">{label}</summary>
      {messages.map((message, index) => <p key={index} className="mt-2 break-words">{message}</p>)}
    </details>
  ) : null;
}
