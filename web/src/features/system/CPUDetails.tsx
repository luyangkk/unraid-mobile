import type { SystemSnapshot } from "../../lib/api";
import { formatReportedFrequency, type CPUWindow } from "../../lib/system";

// CPUDetails keeps native disclosure and radio controls stable across cached samples.
export function CPUDetails({ snapshot, expanded, onExpandedChange, window, onWindowChange, stale }: {
  snapshot: SystemSnapshot;
  expanded: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  window: CPUWindow;
  onWindowChange?: (seconds: CPUWindow) => void;
  stale: boolean;
}) {
  const muted = stale ? "text-stale-text-muted" : "text-text-muted";
  const info = snapshot.cpuInfo;
  const count = info?.logicalCPUCount;
  const processors = [...(snapshot.cpuLogicalProcessors ?? [])].sort((a, b) => a.id - b.id);
  const frequency = formatReportedFrequency(info?.reportedFrequencyHz);
  return (
    <details open={expanded} className="mt-5 min-w-0 border-t border-border"
      onToggle={(event) => {
        if (event.currentTarget.open !== expanded) onExpandedChange?.(event.currentTarget.open);
      }}>
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
        CPU details{count != null ? <span className={`ml-2 font-normal ${muted}`}>{count} logical CPUs</span> : null}
      </summary>
      <div className="min-w-0 pt-2">
        <dl className="grid min-w-0 gap-3 text-sm">
          <div className="min-w-0">
            <dt className={`text-xs ${muted}`}>Processor</dt>
            <dd className="mt-1 min-w-0 break-words">{info?.model ?? "—"}
              {info?.model == null ? <p className={`mt-1 text-xs ${muted}`}>
                {snapshot.diagnostics.cpuModel ?? "Processor information unavailable"}
              </p> : null}
            </dd>
          </div>
          <div>
            <dt className={`text-xs ${muted}`}>Reported frequency</dt>
            <dd className="mt-1 tabular-nums">
              {frequency === "—" ? "—" : <>{frequency.split(" ")[0]} <span className={`text-xs ${muted}`}>{frequency.split(" ")[1]}</span></>}
              {frequency === "—" ? <p className={`mt-1 text-xs ${muted}`}>
                {snapshot.diagnostics.cpuFrequency ?? "Reported frequency unavailable"}
              </p> : null}
            </dd>
          </div>
          <div>
            <dt className={`text-xs ${muted}`}>Logical CPUs</dt>
            <dd className="mt-1 tabular-nums">{count ?? "—"}
              {count == null ? <p className={`mt-1 text-xs ${muted}`}>
                {snapshot.diagnostics.cpuLogicalProcessors ?? "Logical CPU count unavailable"}
              </p> : null}
            </dd>
          </div>
        </dl>
        <fieldset className="mt-4 min-w-0">
          <legend className={`text-xs ${muted}`}>CPU trend window</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {([10, 30, 60] as const).map((seconds) => (
              <label key={seconds} className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border px-1 text-sm has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring ${
                window === seconds ? "border-brand-text bg-surface-muted text-brand-text" : "border-control-border"
              }`}>
                <input type="radio" name="cpu-window" value={seconds} checked={window === seconds}
                  className="shrink-0 accent-brand-text" onChange={() => onWindowChange?.(seconds)} />
                {seconds}s
              </label>
            ))}
          </div>
        </fieldset>
        {processors.length ? (
          <ul aria-label="Logical CPU usage" className="mt-4 grid min-w-0 grid-cols-2 gap-x-3 gap-y-4">
            {processors.map((processor) => (
              <li key={processor.id} className="min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-1 gap-y-1 text-xs">
                  <h4 className={muted}>CPU {processor.id}</h4>
                  <span className="font-mono tabular-nums">
                    {processor.usage === null ? "—" : `${processor.usage.toFixed(1)}%`}
                  </span>
                </div>
                {processor.usage === null ? (
                  <p className={`mt-1 break-words text-xs ${muted}`}>{processor.reason ?? "CPU usage unavailable"}</p>
                ) : (
                  <div role="meter" aria-label={`CPU ${processor.id} usage`} aria-valuemin={0} aria-valuemax={100}
                    aria-valuenow={processor.usage} aria-valuetext={`${processor.usage.toFixed(1)}%`}
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-progress-track">
                    <div className="h-full rounded-full bg-progress-fill" style={{ width: `${processor.usage}%` }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : <p className={`mt-4 break-words text-xs ${muted}`}>
          {snapshot.diagnostics.cpuLogicalProcessors ?? "Logical CPU measurements unavailable"}
        </p>}
      </div>
    </details>
  );
}
