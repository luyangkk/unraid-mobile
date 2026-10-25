import { useLayoutEffect, useRef, useState } from "react";
import type { StorageCapacity, StorageSnapshot } from "../../lib/api";
import { formatBytes } from "../../lib/system";
import { DiskDetailSheet } from "./DiskDetailSheet";
import { diskTemperature, powerStateClass, powerStateLabel } from "./disk";

// StoragePanel renders cached summaries and selects disk details by current name.
export function StoragePanel({
  snapshot,
  overview = false,
  stale = false,
  errorMessage,
}: {
  snapshot: StorageSnapshot;
  overview?: boolean;
  stale?: boolean;
  errorMessage?: string;
}) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const disksSummaryRef = useRef<HTMLElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const selectedDisk = snapshot.available
    ? snapshot.disks.find((disk) => disk.name === selectedName) : undefined;
  // Keep the return target connected even when polling changes an exiting sheet.
  useLayoutEffect(() => {
    if (returnFocusRef.current && !returnFocusRef.current.isConnected) {
      returnFocusRef.current = disksSummaryRef.current ?? sectionRef.current;
    }
  }, [snapshot, overview]);
  return (
    <section ref={sectionRef} tabIndex={-1} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h2 className="text-lg font-semibold">Storage</h2>
      {stale ? (
        <div className="mt-3 break-words text-sm text-amber-200" role="status">
          <p>
            {errorMessage
              ? `Storage refresh failed. Showing the last sample. ${errorMessage}`
              : "Showing the last sample."}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Sampled <time dateTime={snapshot.timestamp}>{snapshot.timestamp}</time>
          </p>
        </div>
      ) : null}
      <div className={stale ? "opacity-60" : ""}>
        {!snapshot.available ? (
          <div className="mt-3 break-words text-sm text-amber-200" role="status">
            <p>{snapshot.reason || "Storage data unavailable"}</p>
            <p className="mt-2 text-slate-400">
              Add a read-only path: /var/local/emhttp → /host/var/local/emhttp in
              the Unraid container settings.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap justify-between gap-3">
              <h3 className="font-medium">Array</h3>
              <span className="min-w-0 break-words text-sm text-slate-400">
                {snapshot.array.state} · {snapshot.array.diskCount} data disks
              </span>
            </div>
            <Capacity capacity={snapshot.array.capacity} />
            <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-slate-800 pt-3 text-sm">
              <h3>Parity</h3>
              <span className="min-w-0 break-words text-slate-400">
                {snapshot.parity.state}
                {snapshot.parity.progress !== null
                  ? ` · ${snapshot.parity.progress.toFixed(1)}%`
                  : ""}
                {snapshot.parity.action ? ` · ${snapshot.parity.action}` : ""}
              </span>
            </div>
            <div className="mt-4 border-t border-slate-800 pt-3">
              <h3 className="text-sm font-medium">Pools{overview ? ` (${snapshot.pools.length})` : ""}</h3>
              {snapshot.pools.length === 0 ? (
                <p className="mt-2 text-sm text-slate-400">No pools configured</p>
              ) : (
                snapshot.pools.map((pool) => (
                  <div className="mt-3" key={pool.name}>
                    <div className="flex flex-wrap justify-between gap-2 text-sm">
                      <span className="min-w-0 break-words">{pool.name}</span>
                      <span className="min-w-0 break-words text-slate-400">
                        {pool.state || "Unknown"} · {pool.diskCount} devices ·{" "}
                        {pool.filesystem || "Unknown filesystem"}
                      </span>
                    </div>
                    <Capacity capacity={pool.capacity} />
                  </div>
                ))
              )}
            </div>
            {!overview ? (
              <details className="mt-4 border-t border-slate-800 pt-3">
                <summary ref={disksSummaryRef} className="min-h-11 cursor-pointer text-sm font-medium">
                  Disks ({snapshot.disks.length})
                </summary>
                {snapshot.disks.map((disk) => (
                  <button
                    type="button"
                    key={disk.name}
                    aria-label={`View ${disk.name} details`}
                    aria-haspopup="dialog"
                    aria-expanded={selectedName === disk.name}
                    className="mt-3 min-h-11 w-full rounded-xl bg-slate-950/60 p-3 text-left text-sm hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-cyan-300"
                    onClick={(event) => {
                      returnFocusRef.current = event.currentTarget;
                      setSelectedName(disk.name);
                    }}
                  >
                    <span className="flex flex-wrap justify-between gap-2 font-medium">
                      <span className="min-w-0 break-words">
                        {disk.name} · {disk.role}
                      </span>
                      <span className={powerStateClass(disk.powerState)}>
                        {powerStateLabel(disk.powerState)}
                      </span>
                    </span>
                    <span className="mt-2 flex flex-wrap justify-between gap-2 break-words text-xs text-slate-400 tabular-nums">
                      <span>
                        {disk.capacity
                          ? formatBytes(disk.capacity.totalBytes)
                          : disk.sizeBytes === null ? "Size unavailable" : formatBytes(disk.sizeBytes)}
                      </span>
                      <span>Temp {diskTemperature(disk)}</span>
                    </span>
                  </button>
                ))}
              </details>
            ) : null}
            {!overview && snapshot.diagnostics.length > 0 ? (
              <details className="mt-3 text-xs text-slate-400">
                <summary className="cursor-pointer">Storage diagnostics</summary>
                {snapshot.diagnostics.map((text, index) => (
                  <p className="mt-2 break-words" key={index}>
                    {text}
                  </p>
                ))}
              </details>
            ) : null}
          </>
        )}
      </div>
      {!overview ? (
        <DiskDetailSheet
          open={selectedName !== null}
          onOpenChange={(open) => {
            if (!open) {
              if (!returnFocusRef.current?.isConnected) {
                returnFocusRef.current = disksSummaryRef.current ?? sectionRef.current;
              }
              setSelectedName(null);
            }
          }}
          disk={selectedDisk} selectedName={selectedName}
          timestamp={snapshot.timestamp} stale={stale} errorMessage={errorMessage}
          unavailableReason={!snapshot.available ? snapshot.reason || "Storage data unavailable" : undefined}
          returnFocusRef={returnFocusRef}
        />
      ) : null}
    </section>
  );
}

// Capacity displays reported byte totals and leaves missing capacity unavailable.
function Capacity({ capacity }: { capacity: StorageCapacity | null }) {
  if (!capacity)
    return <p className="mt-2 text-sm text-slate-400">Capacity unavailable</p>;
  const percent =
    capacity.totalBytes > 0
      ? Math.min(100, (100 * capacity.usedBytes) / capacity.totalBytes)
      : 0;
  return (
    <div className="mt-2">
      <div className="flex flex-wrap justify-between gap-2 text-sm tabular-nums">
        <span className="min-w-0 break-words">
          {formatBytes(capacity.usedBytes)} / {formatBytes(capacity.totalBytes)}
        </span>
        <span className="text-slate-400">{percent.toFixed(1)}%</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-cyan-400"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
