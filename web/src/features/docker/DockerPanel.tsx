import { useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { ContainerIcon } from "./ContainerIcon";
import type { DockerContainer, DockerSnapshot } from "../../lib/api";
import {
  containerGroup,
  dockerOverviewItems,
  type DockerOverviewItem,
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
  overviewExpanded = false,
  onOverviewExpandedChange,
  loadIcons = true,
}: {
  snapshot: DockerSnapshot;
  overview?: boolean;
  stale?: boolean;
  errorMessage?: string;
  overviewExpanded?: boolean;
  onOverviewExpandedChange?: (expanded: boolean) => void;
  loadIcons?: boolean;
}) {
  const [runningCollapsed, setRunningCollapsed] = useState(() => overview ? false : readRunningCollapsed("docker"));
  const [stoppedExpanded, setStoppedExpanded] = useState(false);
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
      <div className={stale ? overview ? "text-stale-foreground" : "opacity-60" : ""}>
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
                {overview ? (
                  <RunningOverview items={dockerOverviewItems(snapshot)} expanded={overviewExpanded}
                    onExpandedChange={onOverviewExpandedChange} stale={stale} loadIcons={loadIcons} />
                ) : <details
                  className="mt-3"
                  open={!runningCollapsed}
                  onToggle={(event) => {
                    const collapsed = !event.currentTarget.open;
                    setRunningCollapsed(collapsed);
                    saveRunningCollapsed(collapsed, "docker");
                  }}
                >
                  <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
                    Running ({groups.running.length})
                  </summary>
                  {groups.running.length === 0 ? (
                    <p className="pb-3 text-sm text-text-muted">No running containers</p>
                  ) : groups.running.map((container) => (
                    <ContainerRow key={container.id} container={container} loadIcons={loadIcons && !runningCollapsed} />
                  ))}
                </details>}
                {!overview ? (
                  <details className="mt-2 border-t border-border" open={stoppedExpanded} onToggle={(event) => setStoppedExpanded(event.currentTarget.open)}>
                    <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
                      Stopped ({groups.stopped.length})
                    </summary>
                    {groups.stopped.length === 0 ? (
                      <p className="pb-3 text-sm text-text-muted">No stopped containers</p>
                    ) : groups.stopped.map((container) => (
                      <ContainerRow key={container.id} container={container} loadIcons={loadIcons && stoppedExpanded} />
                    ))}
                  </details>
                ) : null}
                {!overview && groups.other.length > 0 ? (
                  <div className="mt-2 border-t border-border pt-3">
                    <h3 className="mb-3 text-sm font-medium">Other ({groups.other.length})</h3>
                    {groups.other.map((container) => (
                      <ContainerRow key={container.id} container={container} loadIcons={loadIcons} />
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

// ContainerRow reuses the authenticated icon loader without changing metric columns.
function ContainerRow({ container, loadIcons }: { container: DockerContainer; loadIcons: boolean }) {
  return (
    <article className="mb-3 rounded-xl bg-surface-muted/60 p-3 text-sm">
      <div className="flex items-center gap-3">
        <ContainerIcon container={container} enabled={loadIcons} className="size-10 rounded-xl" />
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

const overviewLimit = 8;

// RunningOverview keeps Home compact without changing the shared snapshot order.
function RunningOverview({ items, expanded, onExpandedChange, stale, loadIcons }: {
  items: DockerOverviewItem[];
  expanded: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  stale: boolean;
  loadIcons: boolean;
}) {
  const listId = useId();
  const shown = expanded ? items : items.slice(0, overviewLimit);
  if (items.length === 0) return <p className={`mt-3 text-sm ${stale ? "text-stale-text-muted" : "text-text-muted"}`}>No running containers</p>;
  return (
    <>
      <ul id={listId} aria-label="Running containers" className="mt-4 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2">
        {shown.map((container) => (
          <li key={container.id} className="flex min-h-12 min-w-0 items-center gap-2"
            aria-label={container.folder ? `${container.name}, folder, ${container.running} of ${container.total} containers running` : undefined}>
            <ContainerIcon container={container} enabled={loadIcons} />
            <span className="min-w-0 truncate text-sm font-medium" title={container.name}>{container.name}</span>
          </li>
        ))}
      </ul>
      {items.length > overviewLimit ? (
        <Button type="button" variant="secondary" className="mt-3 w-full" aria-expanded={expanded}
          aria-controls={listId} onClick={() => onExpandedChange?.(!expanded)}>
          {expanded ? "Show fewer containers" : `Show ${items.length - overviewLimit} more ${items.length - overviewLimit === 1 ? "container" : "containers"}`}
        </Button>
      ) : null}
    </>
  );
}
