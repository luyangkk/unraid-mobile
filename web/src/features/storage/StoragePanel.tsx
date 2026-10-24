import type { StorageCapacity, StorageSnapshot } from "../../lib/api";
import { formatBytes, formatRate } from "../../lib/system";

export function StoragePanel({
  snapshot,
  stale = false,
}: {
  snapshot: StorageSnapshot;
  stale?: boolean;
}) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h2 className="text-lg font-semibold">Storage</h2>
      {!snapshot.available ? (
        <div className="mt-3 text-sm text-amber-200" role="status">
          <p>{snapshot.reason || "Storage data unavailable"}</p>
          <p className="mt-2 text-slate-400">
            Add a read-only path: /var/local/emhttp → /host/var/local/emhttp in
            the Unraid container settings.
          </p>
        </div>
      ) : (
        <>
          {stale ? (
            <p role="status" className="mt-3 text-sm text-amber-200">
              Storage refresh failed. Showing the last sample.
            </p>
          ) : null}
          <div className="mt-4 flex justify-between gap-3">
            <h3 className="font-medium">Array</h3>
            <span className="text-sm text-slate-400">
              {snapshot.array.state} · {snapshot.array.diskCount} data disks
            </span>
          </div>
          <Capacity capacity={snapshot.array.capacity} />
          <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-slate-800 pt-3 text-sm">
            <h3>Parity</h3>
            <span className="text-slate-400">
              {snapshot.parity.state}
              {snapshot.parity.progress !== null
                ? ` · ${snapshot.parity.progress.toFixed(1)}%`
                : ""}
              {snapshot.parity.action ? ` · ${snapshot.parity.action}` : ""}
            </span>
          </div>
          <div className="mt-4 border-t border-slate-800 pt-3">
            <h3 className="text-sm font-medium">Pools</h3>
            {snapshot.pools.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">No pools configured</p>
            ) : (
              snapshot.pools.map((pool) => (
                <div className="mt-3" key={pool.name}>
                  <div className="flex flex-wrap justify-between gap-2 text-sm">
                    <span>{pool.name}</span>
                    <span className="text-slate-400">
                      {pool.state || "Unknown"} · {pool.diskCount} devices ·{" "}
                      {pool.filesystem || "Unknown filesystem"}
                    </span>
                  </div>
                  <Capacity capacity={pool.capacity} />
                </div>
              ))
            )}
          </div>
          <details className="mt-4 border-t border-slate-800 pt-3">
            <summary className="cursor-pointer text-sm font-medium">
              Disks ({snapshot.disks.length})
            </summary>
            {snapshot.disks.map((disk) => (
              <article
                key={disk.name}
                className="mt-3 rounded-xl bg-slate-950/60 p-3 text-sm"
              >
                <div className="flex flex-wrap justify-between gap-2 font-medium">
                  <span>
                    {disk.name} · {disk.role}
                  </span>
                  <span className={powerStateClass(disk.powerState)}>
                    {powerStateLabel(disk.powerState)}
                  </span>
                </div>
                <p className="mt-1 break-words text-xs text-slate-400">
                  {disk.device || "Missing device"} · {disk.status} ·{" "}
                  {disk.filesystem || "No filesystem"}
                </p>
                {disk.capacity ? (
                  <Capacity capacity={disk.capacity} />
                ) : (
                  <p className="mt-2 text-xs text-slate-400">
                    {disk.sizeBytes === null
                      ? "Size unavailable"
                      : formatBytes(disk.sizeBytes)}{" "}
                    · {disk.filesystemStatus || "Filesystem unavailable"}
                  </p>
                )}
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-400">
                  <span>
                    Temp{" "}
                    {disk.temperature === null
                      ? "—"
                      : `${disk.temperature.toFixed(0)} °C`}
                  </span>
                  <span>Read {formatRate(disk.readBytesPerSecond)}</span>
                  <span className="text-right">
                    Write {formatRate(disk.writeBytesPerSecond)}
                  </span>
                </div>
              </article>
            ))}
          </details>
          {snapshot.diagnostics.length > 0 ? (
            <details className="mt-3 text-xs text-slate-400">
              <summary className="cursor-pointer">Storage diagnostics</summary>
              {snapshot.diagnostics.map((text, index) => (
                <p className="mt-2 break-words" key={index}>
                  {text}
                </p>
              ))}
            </details>
          ) : null}
          <p className="mt-3 text-right text-xs text-slate-500">
            Sampled {new Date(snapshot.timestamp).toLocaleTimeString()}
          </p>
        </>
      )}
    </section>
  );
}

function powerStateLabel(
  state: StorageSnapshot["disks"][number]["powerState"],
) {
  switch (state) {
    case "active":
      return "Spun up";
    case "standby":
      return "Spun down";
    default:
      return "Power state unknown";
  }
}

function powerStateClass(
  state: StorageSnapshot["disks"][number]["powerState"],
) {
  return state === "active"
    ? "text-emerald-300"
    : state === "standby"
      ? "text-slate-400"
      : "text-amber-200";
}

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
        <span>
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
