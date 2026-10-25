import { Box } from "lucide-react";
import { useState } from "react";
import type { DockerContainer, DockerSnapshot } from "../../lib/api";
import {
  containerGroup,
  containerStateLabel,
  formatContainerUptime,
  readRunningCollapsed,
  saveRunningCollapsed,
} from "../../lib/docker";
import { formatBytes, formatRate } from "../../lib/system";

// DockerPanel displays the cached read-only snapshot and independent freshness.
export function DockerPanel({
  snapshot,
  overview = false,
  stale = false,
  errorMessage,
}: {
  snapshot: DockerSnapshot;
  overview?: boolean;
  stale?: boolean;
  errorMessage?: string;
}) {
  const preferencePage = overview ? "home" : "docker";
  const [runningCollapsed, setRunningCollapsed] = useState(() => readRunningCollapsed(preferencePage));
  const groups: Record<"running" | "stopped" | "other", DockerContainer[]> = {
    running: [],
    stopped: [],
    other: [],
  };
  for (const container of snapshot.containers)
    groups[containerGroup(container.state)].push(container);

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Docker</h2>
        {snapshot.available ? (
          <span className="text-xs text-text-muted">
            {snapshot.summary.running} running · Read only
          </span>
        ) : null}
      </div>
      {stale ? (
        <div className="mt-3 break-words text-sm text-warning" role="status">
          <p>
            {errorMessage
              ? `Docker refresh failed. Showing the last sample. ${errorMessage}`
              : "Showing the last sample."}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Sampled <time dateTime={snapshot.timestamp}>{snapshot.timestamp}</time>
          </p>
        </div>
      ) : null}
      <div className={stale ? "opacity-60" : ""}>
        {!snapshot.available ? (
          <p className="mt-3 break-words text-sm text-warning" role="status">
            {snapshot.reason || "Docker data unavailable"}
          </p>
        ) : (
          <>
            {snapshot.containers.length === 0 ? (
              <p className="mt-3 text-sm text-text-muted">No containers configured</p>
            ) : (
              <>
                <details
                  className="mt-3"
                  open={!runningCollapsed}
                  onToggle={(event) => {
                    const collapsed = !event.currentTarget.open;
                    setRunningCollapsed(collapsed);
                    saveRunningCollapsed(collapsed, preferencePage);
                  }}
                >
                  <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
                    Running ({groups.running.length})
                  </summary>
                  {groups.running.length === 0 ? (
                    <p className="pb-3 text-sm text-text-muted">No running containers</p>
                  ) : groups.running.map((container) => (
                    <ContainerRow key={container.id} container={container} />
                  ))}
                </details>
                {!overview ? (
                  <details className="mt-2 border-t border-border">
                    <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
                      Stopped ({groups.stopped.length})
                    </summary>
                    {groups.stopped.length === 0 ? (
                      <p className="pb-3 text-sm text-text-muted">No stopped containers</p>
                    ) : groups.stopped.map((container) => (
                      <ContainerRow key={container.id} container={container} />
                    ))}
                  </details>
                ) : null}
                {!overview && groups.other.length > 0 ? (
                  <div className="mt-2 border-t border-border pt-3">
                    <h3 className="mb-3 text-sm font-medium">Other ({groups.other.length})</h3>
                    {groups.other.map((container) => (
                      <ContainerRow key={container.id} container={container} />
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </>
        )}
        {snapshot.diagnostics.length > 0 ? (
          <details className="mt-3 text-xs text-text-muted">
            <summary className="min-h-11 cursor-pointer py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">Docker diagnostics</summary>
            {snapshot.diagnostics.map((message, index) => (
              <p key={index} className="mt-2 break-words">{message}</p>
            ))}
          </details>
        ) : null}
      </div>
    </section>
  );
}

// ContainerRow uses stable metric columns and a generic local container icon.
function ContainerRow({ container }: { container: DockerContainer }) {
  return (
    <article className="mb-3 rounded-xl bg-surface-muted/60 p-3 text-sm">
      <div className="flex items-center gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-muted text-text-muted">
          <Box className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h4 className="break-words font-medium">{container.name}</h4>
          <p className={`mt-0.5 text-xs ${container.state === "running" ? "text-success" : "text-warning"}`}>
            {containerStateLabel(container.state)}
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-2 gap-y-2 break-words text-xs tabular-nums text-text-muted">
        <span>CPU {container.cpuUsage === null ? "—" : `${container.cpuUsage.toFixed(1)}%`}</span>
        <span>RAM {container.memoryUsedBytes === null ? "—" : formatBytes(container.memoryUsedBytes)}</span>
        <span className="col-span-2">Uptime {formatContainerUptime(container.uptimeSeconds)}</span>
        <span>↓ {formatRate(container.networkRXRate)}</span>
        <span>↑ {formatRate(container.networkTXRate)}</span>
      </div>
      {container.diagnostics.length > 0 ? (
        <details className="mt-2 text-xs text-text-muted">
          <summary className="min-h-11 cursor-pointer py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">Container diagnostics</summary>
          {container.diagnostics.map((message, index) => (
            <p key={index} className="mt-2 break-words">{message}</p>
          ))}
        </details>
      ) : null}
    </article>
  );
}
