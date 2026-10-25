import type { RefObject } from "react";
import { AppSheet } from "../../components/app/AppSheet";
import { formatBytes, formatRate } from "../../lib/system";
import { diskTemperature, powerStateClass, powerStateLabel, type StorageDisk } from "./disk";

// DiskDetailSheet displays only fields from the current Storage snapshot.
export function DiskDetailSheet({
  open, onOpenChange, disk, selectedName, timestamp, stale, errorMessage,
  unavailableReason, returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disk?: StorageDisk;
  selectedName: string | null;
  timestamp: string;
  stale: boolean;
  errorMessage?: string;
  unavailableReason?: string;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const total = disk?.capacity?.totalBytes ?? disk?.sizeBytes ?? null;
  return (
    <AppSheet open={open} onOpenChange={onOpenChange} title={selectedName || "Disk details"}
      description="Disk details · Current read-only Storage sample" returnFocusRef={returnFocusRef}>
      {stale ? (
        <p role="status" className="mb-3 break-words text-sm text-amber-200">
          {errorMessage
            ? `Storage refresh failed. Showing the last sample. ${errorMessage}`
            : "Showing the last sample."}
        </p>
      ) : null}
      <div className={stale ? "opacity-60" : ""}>
        {disk ? (
          <>
            <p className="mb-3 text-sm text-slate-400">Temp {diskTemperature(disk)}</p>
            <dl className="divide-y divide-slate-800 text-sm tabular-nums">
              <Detail label="Role" value={disk.role || "—"} />
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-3 py-3">
                <dt className="text-slate-400">Power</dt>
                <dd className={`min-w-0 break-words text-right ${powerStateClass(disk.powerState)}`}>{powerStateLabel(disk.powerState)}</dd>
              </div>
              <Detail label="Used" value={disk.capacity ? formatBytes(disk.capacity.usedBytes) : "—"} />
              <Detail label="Available" value={disk.capacity ? formatBytes(disk.capacity.freeBytes) : "—"} />
              <Detail label="Total" value={total === null ? "—" : formatBytes(total)} />
              <Detail label="Filesystem" value={disk.filesystem || "—"} />
              <Detail label="Filesystem status" value={disk.filesystemStatus || "—"} />
              <Detail label="Read" value={formatRate(disk.readBytesPerSecond)} />
              <Detail label="Write" value={formatRate(disk.writeBytesPerSecond)} />
              <Detail label="Device" value={disk.device || "—"} />
            </dl>
          </>
        ) : (
          <p role="status" className="break-words text-sm text-amber-200">
            {unavailableReason || "磁盘已不在最新快照中"}
          </p>
        )}
      </div>
      <p className="mt-4 break-words text-xs text-slate-400">
        Sampled <time dateTime={timestamp}>{timestamp}</time>
      </p>
    </AppSheet>
  );
}

// Detail pairs each whitelisted field with a wrapping, readable value.
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-3 py-3">
      <dt className="text-slate-400">{label}</dt>
      <dd className="min-w-0 break-words text-right">{value}</dd>
    </div>
  );
}
